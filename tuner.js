(function () {
    'use strict';

    /**
     * Lampa Tuner — personal tweaks, hosted on GitHub Pages.
     * v2.0.0
     *  - settings: parser -> Smart Parser on the Mac (:9118), timeout 30s, interview "all"
     *  - movie page: "Торренты" first, "Трейлеры" second, both on the main row;
     *    duplicate / nag buttons removed; focus starts on "Торренты"
     *  - "Торренты" button shows how many matching releases exist (or "нет")
     *  - cards: red "нет торрентов" badge on focused cards (and their neighbours)
     *    when the Smart Parser finds nothing for that exact title + year
     */

    var VERSION = '2.2.0';
    var SMART = 'http://192.168.1.234:9118';
    var CACHE_KEY = 'tuner_torrent_counts';
    var CACHE_TTL = 12 * 3600 * 1000;

    // buttons we never want on the movie page (duplicates / nags / paid-only)
    var KILL = ['.view---torrent', '.onlymodels-migration-button', '.gpbay-button'];

    // ---------------------------------------------------------------- settings
    function applySettings() {
        var S = Lampa.Storage;
        if (S.get('jackett_url', '') !== SMART) S.set('jackett_url', SMART);
        if (S.get('parser_type', '') !== 'jackett') S.set('parser_type', 'jackett');
        if (!S.get('parser_use', false)) S.set('parser_use', true);
        var t = parseInt(S.get('parse_timeout', '5'), 10);
        if (!t || t < 30) S.set('parse_timeout', 30);
        S.set('jackett_interview', 'all');
    }

    // ---------------------------------------------------------------- count lookup
    var cache = {};
    try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (e) { cache = {}; }
    function saveCache() {
        try {
            var now = Date.now(), k;
            for (k in cache) if (now - cache[k].t > CACHE_TTL) delete cache[k];
            localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
        } catch (e) {}
    }

    function cardInfo(d) {
        if (!d || !d.id) return null;
        var serial = !!(d.name || d.original_name || d.first_air_date);
        var date = d.release_date || d.first_air_date || '';
        return {
            key: (serial ? 'tv' : 'mv') + d.id,
            title: d.title || d.name || '',
            orig: d.original_title || d.original_name || '',
            year: (date + '').slice(0, 4),
            serial: serial,
            future: date && new Date(date) > new Date()
        };
    }

    var inflight = {};
    function lookup(info, cb) {
        var c = cache[info.key];
        if (c && Date.now() - c.t < CACHE_TTL) return cb(c.n);
        if (info.future) return cb(0);
        if (inflight[info.key]) { inflight[info.key].push(cb); return; }
        inflight[info.key] = [cb];
        var url = SMART + '/check?title=' + encodeURIComponent(info.title) +
            '&title_original=' + encodeURIComponent(info.orig) +
            '&year=' + info.year + '&is_serial=' + (info.serial ? '2' : '1');
        var x = new XMLHttpRequest();
        x.open('GET', url, true);
        x.onreadystatechange = function () {
            if (x.readyState !== 4) return;
            var n = -1;                                    // -1 = unknown (parser unreachable)
            if (x.status === 200) {
                try { n = JSON.parse(x.responseText).count; } catch (e) {}
                cache[info.key] = { n: n, t: Date.now() };
                saveCache();
            }
            var cbs = inflight[info.key] || [];
            delete inflight[info.key];
            for (var i = 0; i < cbs.length; i++) cbs[i](n);
        };
        x.send();
    }

    // ---------------------------------------------------------------- styles
    function injectCss() {
        var css =
            '.tuner-badge{position:absolute;left:0;right:0;bottom:0;padding:.35em .4em;font-size:.8em;' +
            'text-align:center;background:rgba(190,30,45,.92);color:#fff;border-radius:0 0 1em 1em;z-index:3}' +
            '.card__view{position:relative}' +
            '.tuner-count{opacity:.75;margin-left:.35em}' +
            '.view--torrent.tuner-empty{opacity:.55}';
        var st = document.createElement('style');
        st.textContent = css;
        document.head.appendChild(st);
    }

    // ---------------------------------------------------------------- movie page
    function layout(body, row, e, refocus) {
        KILL.forEach(function (sel) {
            var els = body.querySelectorAll(sel);
            for (var i = 0; i < els.length; i++) els[i].parentNode.removeChild(els[i]);
        });
        var tor = body.querySelector('.view--torrent');
        var tr = body.querySelector('.view--trailer');
        if (tor) { tor.classList.remove('hide'); if (row.firstChild !== tor) row.insertBefore(tor, row.firstChild); }
        if (tr) { tr.classList.remove('hide'); if (tor && tor.nextSibling !== tr) row.insertBefore(tr, tor.nextSibling); }
        if (refocus && tor && Lampa.Activity.active() && Lampa.Activity.active().component === 'full') {
            try {
                Lampa.Controller.toggle('full_start');
                Lampa.Controller.collectionFocus(tor, e.link && e.link.scroll ? e.link.scroll.render() : row);
            } catch (err) {}
        }
        return tor;
    }

    function onFull(e) {
        if (e.type !== 'complite') return;
        var body = e.body && e.body[0] ? e.body[0] : null;
        if (!body) return;
        var row = body.querySelector('.full-start-new__buttons') || body.querySelector('.full-start__buttons');
        if (!row) return;

        var tor = layout(body, row, e, true);
        // other plugins add their buttons after 'complite' too - settle the order again
        [300, 900, 2000].forEach(function (ms) { setTimeout(function () { layout(body, row, e, ms === 300); }, ms); });

        // live count on the torrents button
        var movie = e.data && e.data.movie;
        var info = cardInfo(movie);
        if (tor && info) {
            var label = tor.querySelector('span') || tor;
            lookup(info, function (n) {
                if (n < 0) return;
                var old = tor.querySelector('.tuner-count');
                if (old) old.parentNode.removeChild(old);
                var s = document.createElement('span');
                s.className = 'tuner-count';
                s.textContent = n > 0 ? '· ' + n : '· нет';
                label.appendChild(s);
                if (n === 0) tor.classList.add('tuner-empty');
            });
        }
    }

    // ---------------------------------------------------------------- card badges
    function badge(card, n) {
        var view = card.querySelector('.card__view') || card;
        var old = view.querySelector('.tuner-badge');
        if (n === 0) {
            if (!old) {
                var b = document.createElement('div');
                b.className = 'tuner-badge';
                b.textContent = 'нет торрентов';
                view.appendChild(b);
            }
        } else if (old) old.parentNode.removeChild(old);
    }

    function check(card) {
        if (!card || card.tuner_checked) return;
        var info = cardInfo(card.card_data);
        if (!info) return;
        card.tuner_checked = true;
        lookup(info, function (n) { badge(card, n); });
    }

    var lastFocus = null, focusTimer = null;
    function watchFocus() {
        setInterval(function () {
            var f = document.querySelector('.card.focus');
            if (f === lastFocus) return;
            lastFocus = f;
            clearTimeout(focusTimer);
            if (!f) return;
            focusTimer = setTimeout(function () {         // only when the user pauses on a card
                check(f);
                var n = f.nextElementSibling;
                for (var i = 0; i < 2 && n; i++, n = n.nextElementSibling) {
                    if (n.classList && n.classList.contains('card')) check(n);
                }
            }, 600);
        }, 300);
    }

    // re-paint cached negatives on cards as rows render (no network)
    function paintCached() {
        setInterval(function () {
            var cs = document.querySelectorAll('.card:not(.tuner-painted)');
            for (var i = 0; i < cs.length; i++) {
                cs[i].classList.add('tuner-painted');
                var info = cardInfo(cs[i].card_data);
                if (!info) continue;
                var c = cache[info.key];
                if (c && Date.now() - c.t < CACHE_TTL) { cs[i].tuner_checked = true; badge(cs[i], c.n); }
                else if (info.future) { cs[i].tuner_checked = true; badge(cs[i], 0); }
            }
        }, 1500);
    }

    // ---------------------------------------------------------------- playback speed (Mac speed mode)
    // The Samsung player garbles audio when it speeds up, and the built-in player can't speed audio at all.
    // So any speed other than normal is produced by the Speed Server on the Mac (ffmpeg, pitch-preserving
    // atempo) and the TV just plays that stream at 1x. "Обычная" returns to the original at the same moment.
    var SPEED_SRV = 'http://192.168.1.234:8199';
    var SPEEDS = ['0.75', 'default', '1.25', '1.50', '1.75', '2'];
    var sm = null;          // speed-mode state: {orig, rate, start, a}
    var switching = false;  // true while we close/reopen the player ourselves

    function av() { return window.webapis && webapis.avplay; }
    function curMs() { try { return av().getCurrentTime() || 0; } catch (e) { return 0; } }

    function origPos() {                         // position in the ORIGINAL film, seconds
        var t = curMs() / 1000;
        return sm ? sm.start + t * sm.rate : t;
    }

    function audioN() {                          // n-th audio track currently selected
        try {
            var list = av().getTotalTrackInfo().filter(function (t) { return t.type == 'AUDIO'; });
            var cur = av().getCurrentStreamInfo().filter(function (t) { return t.type == 'AUDIO'; })[0];
            for (var i = 0; i < list.length; i++) if (cur && list[i].index == cur.index) return i;
        } catch (e) {}
        return 0;
    }

    function get(url, cb) {
        var x = new XMLHttpRequest();
        x.open('GET', url, true);
        x.onreadystatechange = function () {
            if (x.readyState !== 4) return;
            var d = null;
            try { d = JSON.parse(x.responseText); } catch (e) {}
            cb(x.status === 200 ? d : null, d);
        };
        x.send();
    }

    function reopen(playdata, after) {
        switching = true;
        try { Lampa.Player.close(); } catch (e) {}
        setTimeout(function () {
            Lampa.Player.play(playdata);
            switching = false;
            if (after) after();
        }, 700);
    }

    function seekWhenReady(sec) {
        var n = 0;
        (function wait() {
            var st = '';
            try { st = av().getState(); } catch (e) {}
            if (st == 'PLAYING' || st == 'PAUSED') {
                try { av().seekTo(Math.max(0, Math.floor(sec * 1000))); } catch (e) {}
            } else if (n++ < 60) setTimeout(wait, 500);
        })();
    }

    function enterSpeed(rate) {
        var orig = sm ? sm.orig : Lampa.Player.playdata();
        if (!orig || !orig.url) return Lampa.Noty.show('Ускорение: не найдено видео');
        var pos = origPos(), a = sm ? sm.a : audioN();
        Lampa.Noty.show('Ускоряю ×' + rate + '…');
        get(SPEED_SRV + '/start?src=' + encodeURIComponent(orig.url) + '&rate=' + rate +
            '&start=' + pos.toFixed(1) + '&a=' + a, function (d, err) {
            if (!d || !d.url) return Lampa.Noty.show('Ускорение не удалось: ' + ((err && err.error) || 'Mac не отвечает'));
            sm = { orig: orig, rate: rate, start: pos, a: a };
            reopen({ url: d.url, title: (orig.title || '') + ' · ×' + rate });
        });
    }

    function exitSpeed() {
        if (!sm) return;
        var pos = origPos(), orig = sm.orig;
        sm = null;
        get(SPEED_SRV + '/stop', function () {});
        reopen(orig, function () { seekWhenReady(pos); });
    }

    function patchSpeed() {
        var ps = Lampa.Storage.get('player_speed', 'default');
        if (ps !== 'default') Lampa.Storage.set('player_speed', 'default');

        // leaving the player while in speed mode -> stop the Mac encoder
        try {
            Lampa.Player.listener.follow('destroy', function () {
                if (switching || !sm) return;
                sm = null;
                get(SPEED_SRV + '/stop', function () {});
            });
        } catch (e) {}

        var show = Lampa.Select.show;
        Lampa.Select.show = function (params) {
            try {
                var isSpeed = params && params.title === Lampa.Lang.translate('player_video_speed');
                if (isSpeed && Lampa.Storage.field('player') === 'tizen') {
                    var cur = sm ? String(sm.rate.toFixed(2)).replace(/0$/, '') : 'default';
                    params.items = SPEEDS.map(function (v) {
                        var same = v === 'default' ? !sm : sm && parseFloat(v) === sm.rate;
                        return { title: v === 'default' ? Lampa.Lang.translate('player_speed_default_title') : v, value: v, selected: !!same };
                    });
                    params.onSelect = function (a) {
                        Lampa.Storage.set('player_speed', 'default');   // keep Lampa's own menu valid
                        try { Lampa.Select.close(); Lampa.Controller.toggle('player'); } catch (e) {}
                        if (a.value === 'default') exitSpeed();
                        else if (!sm || parseFloat(a.value) !== sm.rate) enterSpeed(parseFloat(a.value));
                    };
                }
            } catch (e) {}
            return show.apply(this, arguments);
        };
    }

    // ---------------------------------------------------------------- start
    function startPlugin() {
        if (window.lampa_tuner_ready) return;
        window.lampa_tuner_ready = true;
        applySettings();
        injectCss();
        Lampa.Listener.follow('full', onFull);
        patchSpeed();
        watchFocus();
        paintCached();
        try {
            Lampa.SettingsApi.addParam({
                component: 'parser',
                param: { name: 'lampa_tuner_title', type: 'title' },
                field: { name: 'Lampa Tuner v' + VERSION + ' — Smart Parser :9118' }
            });
        } catch (e) {}
        console.log('LampaTuner', 'v' + VERSION + ' active');
    }

    if (window.appready) startPlugin();
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') startPlugin(); });
})();
