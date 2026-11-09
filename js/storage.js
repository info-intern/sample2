/* =========================================================
   storage.js
   LocalStorage への保存・読み込みと、日付まわりの共通処理
   ========================================================= */

/** LocalStorage に保存するときのキー */
const STORAGE_KEYS = {
    state: 'enjiTenko.state',         // 園児ごとの今の状態
    records: 'enjiTenko.records',     // 点呼記録
    absences: 'enjiTenko.absences',   // 欠席連絡
    session: 'enjiTenko.session',     // 途中の点呼（再読み込みしても続きから再開するため）
};

/**
 * LocalStorage から JSON を読み込む。
 * 保存されていない・壊れている・ストレージが使えない場合は fallback を返す。
 * @param {string} key 保存キー
 * @param {*} fallback 読み込めなかったときの値
 * @returns {*} 読み込んだ値
 */
function loadData(key, fallback) {
    try {
        const text = localStorage.getItem(key);
        return text === null ? fallback : JSON.parse(text);
    } catch (error) {
        console.warn('データの読み込みに失敗しました', key, error);
        return fallback;
    }
}

/**
 * LocalStorage に JSON として保存する。
 * @param {string} key 保存キー
 * @param {*} value 保存する値
 * @returns {boolean} 保存できたかどうか
 */
function saveData(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        console.error('データの保存に失敗しました', key, error);
        return false;
    }
}

/**
 * LocalStorage からキーを削除する。
 * @param {string} key 保存キー
 */
function removeData(key) {
    try {
        localStorage.removeItem(key);
    } catch (error) {
        console.error('データの削除に失敗しました', key, error);
    }
}

/**
 * このアプリが保存したデータをすべて削除する（データをリセット用）。
 */
function clearAllData() {
    Object.values(STORAGE_KEYS).forEach(removeData);
}

/**
 * 日付を「YYYY-MM-DD」形式（端末の現地時刻）にする。
 * @param {Date} date 日付
 * @returns {string} 例: 2026-11-09
 */
function toDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * 今日の日付キーを返す。
 * @returns {string} 例: 2026-11-09
 */
function todayKey() {
    return toDateKey(new Date());
}

/**
 * ISO 形式の日時から「HH:MM」を作る。
 * @param {string} iso 日時（ISO 形式）
 * @returns {string} 例: 08:15
 */
function formatTime(iso) {
    if (!iso) {
        return '';
    }
    const date = new Date(iso);
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

/**
 * 日付キーから「11月9日（月）」のような表示用の文字列を作る。
 * @param {string} dateKey YYYY-MM-DD
 * @returns {string} 表示用の日付
 */
function formatDateLabel(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    return `${m}月${d}日（${weekdays[date.getDay()]}）`;
}
