(function () {
    'use strict';

    /**
     * Lampa Tuner — personal tweaks, hosted on GitHub for easy updates.
     * v1.0.0:
     *  - raises parser timeout to 30s (default cuts off slow trackers,
     *    e.g. TPB responses taking 15-20s were dropped -> "no results")
     *  - forces jackett interview mode to "all" (query every indexer,
     *    not only ones Jackett marked healthy)
     */

    var VERSION = '1.0.0';

    function apply() {
        var t = parseInt(Lampa.Storage.get('parse_timeout', '5'), 10);
        if (!t || t < 30) Lampa.Storage.set('parse_timeout', 30);

        Lampa.Storage.set('jackett_interview', 'all');
    }

    function startPlugin() {
        if (window.lampa_tuner_ready) return;
        window.lampa_tuner_ready = true;

        apply();

        // visible marker at the bottom of Settings -> Parser
        try {
            Lampa.SettingsApi.addParam({
                component: 'parser',
                param: { name: 'lampa_tuner_title', type: 'title' },
                field: { name: 'Lampa Tuner v' + VERSION + ' — timeout 30s, опрос: все' }
            });
        } catch (e) {}

        console.log('LampaTuner', 'v' + VERSION + ' active');
    }

    if (window.appready) startPlugin();
    else Lampa.Listener.follow('app', function (e) {
        if (e.type == 'ready') startPlugin();
    });
})();
