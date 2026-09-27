(function () {
    'use strict';

    /**
     * Lampa Remote (client) — polls the Mac relay and drives the UI via Lampa's API.
     * Pairs with ~/lampa-remote/server.py on the Mac.
     * v1.0.0
     */

    var RELAY = 'http://192.168.1.234:8399';
    var POLL_MS = 700;
    var STEP_MS = 160;      // delay between batched steps
    var VERSION = '1.0.0';

    function http(method, path, body, cb) {
        try {
            var x = new XMLHttpRequest();
            x.open(method, RELAY + path, true);
            x.timeout = 4000;
            if (body) x.setRequestHeader('Content-Type', 'application/json');
            x.onreadystatechange = function () {
                if (x.readyState === 4) {
                    var d = null;
                    try { d = JSON.parse(x.responseText); } catch (e) {}
                    if (cb) cb(d, x.status);
                }
            };
            x.send(body ? JSON.stringify(body) : null);
        } catch (e) { if (cb) cb(null, 0); }
    }

    function ack(info) { http('POST', '/ack', info); }

    function reportState() {
        var st = {};
        try {
            var act = Lampa.Activity.active() || {};
            st.component = act.component || '';
            st.title = act.title || '';
        } catch (e) {}
        try { st.controller = Lampa.Controller.enabled().name; } catch (e) {}
        try {
            var f = document.querySelector('.focus, .selector.focus, .menu__item.focus');
            st.focus = f ? (f.textContent || '').trim().slice(0, 120) : '';
        } catch (e) {}
        http('POST', '/state', st);
    }

    // ---- command handlers -------------------------------------------------
    function run(c, done) {
        try {
            switch (c.cmd) {
                case 'move':   Lampa.Controller.move(c.dir); break;      // up/down/left/right
                case 'enter':  Lampa.Controller.enter(); break;
                case 'back':   Lampa.Controller.back(); break;
                case 'toggle': Lampa.Controller.toggle(c.name); break;   // menu/search/settings/player...
                case 'trigger':Lampa.Controller.trigger(c.key); break;   // play/pause/playpause/stop/rewindForward/rewindBack/info
                case 'activity_back': Lampa.Activity.back(); break;
                case 'noty':   Lampa.Noty.show(String(c.text || '')); break;
                case 'reload': setTimeout(function(){ location.reload(); }, 300); break;
                case 'search':
                    Lampa.Activity.push({
                        url: '', title: 'Lampa Remote — ' + c.query,
                        component: 'category_full', page: 2,
                        query: encodeURIComponent(c.query),
                        source: c.source || 'tmdb'
                    });
                    break;
                case 'eval':   /* local LAN, own repo, explicit opt-in */ (0, eval)(c.code); break;
                default: ack({ cmd: c.cmd, ok: false, err: 'unknown' }); if (done) done(); return;
            }
            ack({ cmd: c.cmd, ok: true, arg: c.dir || c.name || c.key || c.query || '' });
        } catch (e) {
            ack({ cmd: c.cmd, ok: false, err: String(e && e.message || e) });
        }
        if (done) done();
    }

    function runBatch(cmds) {
        var i = 0;
        (function next() {
            if (i >= cmds.length) { reportState(); return; }
            run(cmds[i++], function () { setTimeout(next, STEP_MS); });
        })();
    }

    // ---- poll loop --------------------------------------------------------
    function loop() {
        http('GET', '/poll', null, function (d) {
            if (d && d.commands && d.commands.length) runBatch(d.commands);
        });
        setTimeout(loop, POLL_MS);
    }

    function start() {
        if (window.lampa_remote_ready) return;
        window.lampa_remote_ready = true;
        try { Lampa.Noty.show('Lampa Remote v' + VERSION + ' connected'); } catch (e) {}
        reportState();
        loop();
        console.log('LampaRemote v' + VERSION + ' polling ' + RELAY);
    }

    if (window.appready) start();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
})();
