/* =========================================================
   error-display.js
   実機（IroatoReader）では開発者ツールが見られないため、
   JavaScript のエラーが起きたら画面の下に赤い帯で表示する。
   ほかのファイルより先に読み込み、古いブラウザでも動く書き方にしている。
   ========================================================= */

(function () {
    /**
     * エラー内容を画面下部に表示する。
     * @param {string} text 表示する内容
     */
    function showErrorBar(text) {
        var bar = document.getElementById('js-error-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'js-error-bar';
            bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9999;max-height:40vh;overflow:auto;' +
                'padding:10px 12px;background:#b91c1c;color:#fff;font-size:12px;line-height:1.4;white-space:pre-wrap;word-break:break-all;';
            (document.body || document.documentElement).appendChild(bar);
        }
        bar.textContent += (bar.textContent ? '\n' : '') + '【エラー】' + text;
    }

    window.addEventListener('error', function (event) {
        var where = event.filename ? ' (' + event.filename.split('/').pop() + ':' + event.lineno + ')' : '';
        showErrorBar((event.message || 'unknown error') + where);
    });

    window.addEventListener('unhandledrejection', function (event) {
        var reason = event.reason;
        showErrorBar('Promise: ' + (reason && reason.message ? reason.message : String(reason)));
    });
})();
