/* =========================================================
   reader.js
   IroatoReader API を使ったカメレオンコードの読み取り
   （API の詳細は reference.md を参照）
   ========================================================= */

/**
 * IroatoReader アプリの中で動いているかどうかを調べる。
 * PC のブラウザなどで開いた場合は IroatoReader が存在しない。
 * @returns {boolean} IroatoReader が使えるなら true
 */
function isReaderAvailable() {
    return typeof IroatoReader !== 'undefined';
}

/**
 * カメレオンコードを読み取り、読み取れたコードの一覧を返す。
 * 複数読み取りモードなので、カメラに映った名札をまとめて読み取れる。
 * リーダーの完了ボタンで戻ってきたときに結果が返る。
 *
 * IroatoReader が使えない環境（PC のブラウザでの動作確認など）では、
 * 代わりにコードを手入力するテスト用ダイアログを表示する。
 *
 * @param {Object} options 読み取りの設定
 * @param {Object<string,string>} options.displayData コード → 読み取り画面に表示する文字（園児の名前）
 * @param {string} options.labelText リーダー下部に表示する案内文
 * @returns {Promise<{ok: boolean, codes: string[]}>} 読み取り結果
 */
function readCodes(options) {
    if (!isReaderAvailable()) {
        return askCodesForTest(options.labelText);
    }

    return new Promise((resolve) => {
        const reader = new IroatoReader('cc', {
            mode: IroatoReader.multi,
            analyzeLevel: 5,
            displayData: options.displayData,
            labelText: options.labelText,
            buttonText: '完了',
        });

        reader.read((res) => {
            // 成否を確認してから codes を参照する
            if (!res || !res.status || !res.data || !Array.isArray(res.data.codes)) {
                resolve({ ok: false, codes: [] });
                return;
            }
            const codes = res.data.codes.map((item) => String(item.code).trim());
            resolve({ ok: true, codes });
        });
    });
}

/**
 * 【テスト用】IroatoReader が無い環境で、コードを手入力してもらう。
 * 「1, 2, 13」のようにカンマや空白区切りで複数入力できる。
 * @param {string} labelText 案内文
 * @returns {Promise<{ok: boolean, codes: string[]}>} 入力されたコード
 */
function askCodesForTest(labelText) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control';
    input.inputMode = 'numeric';
    input.placeholder = '例: 1, 2, 13';
    input.autocomplete = 'off';

    const note = document.createElement('p');
    note.className = 'form-hint';
    note.textContent = 'IroatoReader の外で開いているため、読み取りの代わりにコードを入力します（カンマ・空白区切りで複数可）。';

    const extra = document.createDocumentFragment();
    extra.append(input, note);

    return showDialog({
        message: `【テスト用】${labelText}`,
        extra,
        buttons: [
            { label: 'キャンセル', value: null, className: 'btn-secondary' },
            { label: '読み取り完了', value: 'ok', className: 'btn-primary' },
        ],
        focus: input,
    }).then((result) => {
        if (result !== 'ok') {
            return { ok: true, codes: [] };
        }
        const codes = input.value.split(/[\s,、，]+/).map((s) => s.trim()).filter((s) => s !== '');
        return { ok: true, codes };
    });
}
