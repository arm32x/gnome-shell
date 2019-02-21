// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const { Clutter, St } = imports.gi;
const Tweener = imports.ui.tweener;

// Shamelessly copied from the layout "hotcorner" ripples implementation
var Ripples = class Ripples {
    constructor(px, py, styleClass) {
        this._x = 0;
        this._y = 0;

        this._px = px;
        this._py = py;

        this._ripple1 = new St.BoxLayout({ style_class: styleClass,
                                           opacity: 0,
                                           can_focus: false,
                                           reactive: false,
                                           visible: false });
        this._ripple1.set_pivot_point(px, py);

        this._ripple2 = new St.BoxLayout({ style_class: styleClass,
                                           opacity: 0,
                                           can_focus: false,
                                           reactive: false,
                                           visible: false });
        this._ripple2.set_pivot_point(px, py);

        this._ripple3 = new St.BoxLayout({ style_class: styleClass,
                                           opacity: 0,
                                           can_focus: false,
                                           reactive: false,
                                           visible: false });
        this._ripple3.set_pivot_point(px, py);
    }

    _animRipple(ripple, delay, time, startScale, startOpacity, finalScale) {
        // We draw a ripple by using a source image and animating it scaling
        // outwards and fading away. We want the ripples to move linearly
        // or it looks unrealistic, but if the opacity of the ripple goes
        // linearly to zero it fades away too quickly, so we use Tweener's
        // 'onUpdate' to give a non-linear curve to the fade-away and make
        // it more visible in the middle section.

        ripple.x = this._x;
        ripple.y = this._y;
        ripple._opacity = startOpacity;
        ripple.visible = true;
        ripple.opacity = 255 * Math.sqrt(startOpacity);
        ripple.scale_x = ripple.scale_y = startScale;
        ripple.set_translation( - this._px * ripple.width, - this._py * ripple.height, 0.0);

        Tweener.addTween(ripple, { _opacity: 0,
                                   scale_x: finalScale,
                                   scale_y: finalScale,
                                   delay: delay,
                                   time: time,
                                   transition: 'linear',
                                   onUpdate() { ripple.opacity = 255 * Math.sqrt(ripple._opacity); },
                                   onComplete() { ripple.visible = false; } });
    }

    addTo(stage) {
        if (this._stage !== undefined) {
            throw new Error('Ripples already added');
            return;
        }

        this._stage = stage;
        this._stage.add_actor(this._ripple1);
        this._stage.add_actor(this._ripple2);
        this._stage.add_actor(this._ripple3);
    }

    playAnimation(x, y) {
        if (this._stage === undefined) {
            throw new Error('Ripples not added');
            return;
        }

        this._x = x;
        this._y = y;

        this._stage.set_child_above_sibling(this._ripple1, null);
        this._stage.set_child_above_sibling(this._ripple2, this._ripple1);
        this._stage.set_child_above_sibling(this._ripple3, this._ripple2);

        // Show three concentric ripples expanding outwards; the exact
        // parameters were found by trial and error, so don't look
        // for them to make perfect sense mathematically

        //                              delay  time  scale opacity => scale
        this._animRipple(this._ripple1, 0.0,   0.83,  0.25,  1.0,     1.5);
        this._animRipple(this._ripple2, 0.05,  1.0,   0.0,   0.7,     1.25);
        this._animRipple(this._ripple3, 0.35,  1.0,   0.0,   0.3,     1);
    }
};
