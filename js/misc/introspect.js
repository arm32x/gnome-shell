import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

const APP_ALLOWLIST = [
    'org.freedesktop.impl.portal.desktop.gtk',
    'org.freedesktop.impl.portal.desktop.gnome',
];

const INTROSPECT_DBUS_API_VERSION = 3;

import {loadInterfaceXML} from './fileUtils.js';
import {DBusSenderChecker} from './util.js';

const IntrospectDBusIface = loadInterfaceXML('org.gnome.Shell.Introspect');

export class IntrospectService {
    constructor() {
        this._dbusImpl =
            Gio.DBusExportedObject.wrapJSObject(IntrospectDBusIface, this);
        this._dbusImpl.export(Gio.DBus.session, '/org/gnome/Shell/Introspect');
        Gio.DBus.session.own_name('org.gnome.Shell.Introspect',
            Gio.BusNameOwnerFlags.REPLACE,
            null, null);

        this._runningApplications = {};
        this._runningApplicationsDirty = true;
        this._activeApplication = null;
        this._activeApplicationDirty = true;
        this._animationsEnabled = true;

        this._appSystem = Shell.AppSystem.get_default();
        this._appSystem.connect('app-state-changed', () => {
            this._runningApplicationsDirty = true;
            this._syncRunningApplications();
        });

        let tracker = Shell.WindowTracker.get_default();
        tracker.connect('notify::focus-app', () => {
            this._activeApplicationDirty = true;
            this._syncRunningApplications();
        });

        tracker.connect('tracked-windows-changed',
            () => this._dbusImpl.emit_signal('WindowsChanged', null));

        this._syncRunningApplications();

        this._senderChecker = new DBusSenderChecker(APP_ALLOWLIST);

        this._settings = St.Settings.get();
        this._settings.connect('notify::enable-animations',
            this._syncAnimationsEnabled.bind(this));
        this._syncAnimationsEnabled();

        const monitorManager = global.backend.get_monitor_manager();
        monitorManager.connect('monitors-changed',
            this._syncScreenSize.bind(this));
        this._syncScreenSize();
    }

    _isStandaloneApp(app) {
        return app.get_windows().some(w => w.transient_for == null);
    }

    _getSandboxedAppId(app) {
        let ids = app.get_windows().map(w => w.get_sandboxed_app_id());
        return ids.find(id => id != null);
    }

    _syncRunningApplications() {
        let tracker = Shell.WindowTracker.get_default();
        let apps = this._appSystem.get_running();
        let seatName = 'seat0';
        let newRunningApplications = {};

        let newActiveApplication = null;
        let focusedApp = tracker.focus_app;

        for (let app of apps) {
            let appInfo = {};
            let isAppActive = focusedApp === app;

            if (!this._isStandaloneApp(app))
                continue;

            if (isAppActive) {
                appInfo['active-on-seats'] = new GLib.Variant('as', [seatName]);
                newActiveApplication = app.get_id();
            }

            let sandboxedAppId = this._getSandboxedAppId(app);
            if (sandboxedAppId)
                appInfo['sandboxed-app-id'] = new GLib.Variant('s', sandboxedAppId);

            newRunningApplications[app.get_id()] = appInfo;
        }

        if (this._runningApplicationsDirty ||
            (this._activeApplicationDirty &&
             this._activeApplication !== newActiveApplication)) {
            this._runningApplications = newRunningApplications;
            this._activeApplication = newActiveApplication;

            this._dbusImpl.emit_signal('RunningApplicationsChanged', null);
        }
        this._runningApplicationsDirty = false;
        this._activeApplicationDirty = false;
    }

    _isEligibleWindow(window) {
        if (window.is_override_redirect())
            return false;

        let type = window.get_window_type();
        return type === Meta.WindowType.NORMAL ||
            type === Meta.WindowType.DIALOG ||
            type === Meta.WindowType.MODAL_DIALOG ||
            type === Meta.WindowType.UTILITY;
    }

    _getWindowDict(window, app) {
        let focusWindow = global.display.get_focus_window();
        let windowId = window.get_id();
        let frameRect = window.get_frame_rect();
        let title = window.get_title();
        let wmClass = window.get_wm_class();
        let sandboxedAppId = window.get_sandboxed_app_id();
        let windowDict = {
            'app-id': GLib.Variant.new('s', app.get_id()),
            'client-type': GLib.Variant.new('u', window.get_client_type()),
            'id': GLib.Variant.new('t', windowId),
            'is-hidden': GLib.Variant.new('b', window.is_hidden()),
            'has-focus': GLib.Variant.new('b', window === focusWindow),
            'width': GLib.Variant.new('u', frameRect.width),
            'height': GLib.Variant.new('u', frameRect.height),
        };

        // These properties may not be available for all windows:
        if (title != null)
            windowDict['title'] = GLib.Variant.new('s', title);

        if (wmClass != null)
            windowDict['wm-class'] = GLib.Variant.new('s', wmClass);

        if (sandboxedAppId != null) {
            windowDict['sandboxed-app-id'] =
                GLib.Variant.new('s', sandboxedAppId);
        }

        return windowDict;
    }

    async GetRunningApplicationsAsync(params, invocation) {
        try {
            await this._senderChecker.checkInvocation(invocation);
        } catch (e) {
            invocation.return_gerror(e);
            return;
        }

        invocation.return_value(new GLib.Variant('(a{sa{sv}})', [this._runningApplications]));
    }

    async GetWindowsAsync(params, invocation) {
        let apps = this._appSystem.get_running();
        let windowsList = {};

        try {
            await this._senderChecker.checkInvocation(invocation);
        } catch (e) {
            invocation.return_gerror(e);
            return;
        }

        for (let app of apps) {
            let windows = app.get_windows();
            for (let window of windows) {
                if (!this._isEligibleWindow(window))
                    continue;

                let windowId = window.get_id();
                let windowDict = this._getWindowVariant(window, app);
                windowsList[windowId] = new GLib.Variant('a{sv}', windowDict);
            }
        }
        invocation.return_value(new GLib.Variant('(a{ta{sv}})', [windowsList]));
    }

    _syncAnimationsEnabled() {
        let wasAnimationsEnabled = this._animationsEnabled;
        this._animationsEnabled = this._settings.enable_animations;
        if (wasAnimationsEnabled !== this._animationsEnabled) {
            let variant = new GLib.Variant('b', this._animationsEnabled);
            this._dbusImpl.emit_property_changed('AnimationsEnabled', variant);
        }
    }

    _syncScreenSize() {
        const oldScreenWidth = this._screenWidth;
        const oldScreenHeight = this._screenHeight;
        this._screenWidth = global.screen_width;
        this._screenHeight = global.screen_height;

        if (oldScreenWidth !== this._screenWidth ||
            oldScreenHeight !== this._screenHeight) {
            const variant = new GLib.Variant('(ii)',
                [this._screenWidth, this._screenHeight]);
            this._dbusImpl.emit_property_changed('ScreenSize', variant);
        }
    }

    get AnimationsEnabled() {
        return this._animationsEnabled;
    }

    get ScreenSize() {
        return [this._screenWidth, this._screenHeight];
    }

    get version() {
        return INTROSPECT_DBUS_API_VERSION;
    }
}
