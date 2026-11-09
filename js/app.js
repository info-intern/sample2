/* =========================================================
   app.js
   えんじ点呼（幼稚園バス・登園点呼アプリ）の画面と動作
   ========================================================= */

/** 園児の状態（表示名と色分け用の CSS クラス） */
const STATUS = {
    notArrived: { label: '未登園', cls: 'st-not-arrived' },
    onBus: { label: 'バス車内', cls: 'st-on-bus' },
    inSchool: { label: '園内', cls: 'st-in-school' },
    home: { label: '帰宅済み', cls: 'st-home' },
    absent: { label: '欠席', cls: 'st-absent' },
};

/** 人数サマリーに並べる状態の順番 */
const STATUS_ORDER = ['notArrived', 'onBus', 'inSchool', 'home', 'absent'];

/**
 * 点呼の種類
 * from: 点呼の対象になる子の状態 / to: 確定後の状態
 */
const ROLLCALL_TYPES = {
    board: { label: 'バス乗車', icon: '🚌', needsCourse: true, from: 'notArrived', to: 'onBus' },
    alight: { label: 'バス降車', icon: '🏫', needsCourse: true, from: 'onBus', to: 'inSchool' },
    arrive: { label: '登園', icon: '🚶', needsCourse: false, from: 'notArrived', to: 'inSchool' },
    leave: { label: '降園', icon: '🏠', needsCourse: false, from: 'inSchool', to: 'home' },
};

/** 通園方法 */
const COURSES = {
    A: 'Aコース',
    B: 'Bコース',
    walk: '徒歩・送迎',
};

/** バスのコース（点呼開始画面で選べるもの） */
const BUS_COURSES = ['A', 'B'];

/** クラス（絞り込みタブの順番） */
const CLASSES = ['ひよこ組', 'うさぎ組', 'きりん組'];

/** 欠席理由 */
const ABSENCE_REASONS = ['体調不良', '家庭の事情', 'その他'];

/** メモの最大文字数 */
const MEMO_MAX_LENGTH = 200;

/** 体温の入力できる範囲 */
const TEMP_MIN = 34.0;
const TEMP_MAX = 42.0;

/** アプリ全体で使う値 */
const app = {
    roster: [],          // 園児名簿（data/children.json）
    rosterMap: {},       // コード → 園児
    state: null,         // 園児ごとの今の状態（LocalStorage）
    filter: 'all',       // ホームのクラス絞り込み
    startType: null,     // 点呼開始画面で選んだ種類
    startCourse: null,   // 点呼開始画面で選んだコース
    session: null,       // 途中の点呼
    warningCodes: [],    // 置き去り警告画面に表示している子
};

/* =========================================================
   共通の部品
   ========================================================= */

/**
 * 要素を作る（innerHTML を使わずに安全に文字を入れるための小さな関数）。
 * @param {string} tag タグ名
 * @param {string} [className] クラス名
 * @param {string} [text] 中に入れる文字
 * @returns {HTMLElement} 作った要素
 */
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined && text !== null) {
        node.textContent = text;
    }
    return node;
}

/**
 * 要素の中身をすべて取り除く。
 * （replaceChildren は古い iOS のブラウザで使えないため、この関数を使う）
 * @param {HTMLElement} node 対象の要素
 */
function clearChildren(node) {
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}

/**
 * id から要素を取得する。
 * @param {string} id 要素の id
 * @returns {HTMLElement} 要素
 */
function $(id) {
    return document.getElementById(id);
}

/**
 * ダイアログを表示し、押されたボタンの value を返す。
 * iPhone の IroatoReader 内では confirm() が使えない場合があるため、自前で表示する。
 * @param {Object} options 表示内容
 * @param {string} options.message メッセージ
 * @param {Node} [options.extra] メッセージの下に追加で表示する要素
 * @param {Array<{label: string, value: *, className: string}>} options.buttons ボタン
 * @param {HTMLElement} [options.focus] 表示後にフォーカスする要素
 * @returns {Promise<*>} 押されたボタンの value
 */
function showDialog(options) {
    return new Promise((resolve) => {
        const modal = $('modal');
        $('modal-message').textContent = options.message;

        const extra = $('modal-extra');
        clearChildren(extra);
        if (options.extra) {
            extra.append(options.extra);
        }

        const actions = $('modal-actions');
        clearChildren(actions);
        options.buttons.forEach((button) => {
            const node = el('button', `btn ${button.className || 'btn-secondary'}`, button.label);
            node.type = 'button';
            node.addEventListener('click', () => {
                modal.hidden = true;
                resolve(button.value);
            });
            actions.append(node);
        });

        modal.hidden = false;
        if (options.focus) {
            options.focus.focus();
        }
    });
}

/**
 * はい／いいえの確認ダイアログを表示する。
 * @param {string} message メッセージ
 * @param {string} okLabel 「はい」側のボタンの文字
 * @param {string} [okClass] 「はい」側のボタンのクラス
 * @returns {Promise<boolean>} 「はい」が押されたら true
 */
function confirmDialog(message, okLabel, okClass) {
    return showDialog({
        message,
        buttons: [
            { label: 'キャンセル', value: false, className: 'btn-secondary' },
            { label: okLabel, value: true, className: okClass || 'btn-primary' },
        ],
    });
}

/**
 * お知らせダイアログ（OK だけ）を表示する。
 * @param {string} message メッセージ
 * @returns {Promise<*>} 閉じたら解決する
 */
function alertDialog(message) {
    return showDialog({
        message,
        buttons: [{ label: 'OK', value: true, className: 'btn-primary' }],
    });
}

let toastTimer = null;

/**
 * 画面下に短いお知らせを数秒表示する。
 * @param {string} text 表示する文字
 */
function showToast(text) {
    const toast = $('toast');
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.hidden = true;
    }, 2600);
}

/**
 * 画面を切り替える。
 * @param {string} screenId 表示する画面の id
 */
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach((screen) => {
        screen.hidden = screen.id !== screenId;
    });
    const screen = $(screenId);
    $('header-title').textContent = screen.dataset.title;

    // 「もどる」を出す画面（点呼中・警告画面は専用のボタンで戻る）
    const backScreens = ['screen-start', 'screen-absence', 'screen-history'];
    $('header-back').hidden = !backScreens.includes(screenId);
    window.scrollTo(0, 0);
}

/* =========================================================
   園児の状態の管理
   ========================================================= */

/**
 * 園児の表示用の名前（クラス付き）を返す。
 * @param {string} code 園児のコード
 * @returns {string} 例: あおき はると（ひよこ組）
 */
function childLabel(code) {
    const child = app.rosterMap[code];
    return child ? `${child.name}（${child.className}）` : `コード ${code}`;
}

/**
 * 園児の今の状態データを返す。
 * @param {string} code 園児のコード
 * @returns {{status: string, updatedAt: string|null, leftBehind: boolean, leftBehindRecordId: string|null}} 状態
 */
function getChildState(code) {
    return app.state.children[code];
}

/**
 * 全園児が「未登園」の、新しい1日分の状態を作る。
 * @param {string} dateKey 日付
 * @returns {Object} 状態データ
 */
function createDayState(dateKey) {
    const children = {};
    app.roster.forEach((child) => {
        children[child.code] = { status: 'notArrived', updatedAt: null, leftBehind: false, leftBehindRecordId: null };
    });
    return { date: dateKey, children };
}

/**
 * 今日の日付の状態になっているか確認し、日付が変わっていれば全員を「未登園」に戻す。
 * 今日の欠席連絡があれば「欠席」にする。
 */
function ensureToday() {
    const today = todayKey();
    let state = loadData(STORAGE_KEYS.state, null);

    if (!state || state.date !== today || !state.children) {
        state = createDayState(today);
    }

    // 名簿に追加された子がいても困らないように補う
    app.roster.forEach((child) => {
        if (!state.children[child.code]) {
            state.children[child.code] = { status: 'notArrived', updatedAt: null, leftBehind: false, leftBehindRecordId: null };
        }
    });

    // 今日の欠席連絡を反映する（未登園の子のみ）
    loadData(STORAGE_KEYS.absences, [])
        .filter((absence) => absence.date === today)
        .forEach((absence) => {
            const childState = state.children[absence.code];
            if (childState && childState.status === 'notArrived') {
                childState.status = 'absent';
                childState.updatedAt = absence.createdAt;
            }
        });

    app.state = state;
    saveData(STORAGE_KEYS.state, state);

    // 前の日の途中の点呼は破棄する
    const session = loadData(STORAGE_KEYS.session, null);
    if (session && session.date !== today) {
        removeData(STORAGE_KEYS.session);
        app.session = null;
    } else {
        app.session = session;
    }
}

/**
 * 園児の状態を変更して保存する。
 * @param {string} code 園児のコード
 * @param {string} status 新しい状態（STATUS のキー）
 * @param {string} [time] 変更日時（ISO 形式）。省略時は今
 */
function setChildStatus(code, status, time) {
    const childState = getChildState(code);
    childState.status = status;
    childState.updatedAt = time || new Date().toISOString();
    childState.leftBehind = false;
    childState.leftBehindRecordId = null;
}

/**
 * 状態を LocalStorage に保存する。
 */
function saveState() {
    saveData(STORAGE_KEYS.state, app.state);
}

/**
 * 置き去りの可能性がある（バス降車で確認できなかった）子のコード一覧を返す。
 * @returns {string[]} コード一覧
 */
function getLeftBehindCodes() {
    return app.roster
        .map((child) => child.code)
        .filter((code) => {
            const childState = getChildState(code);
            return childState.leftBehind && childState.status === 'onBus';
        });
}

/* =========================================================
   ホーム画面
   ========================================================= */

/**
 * ホーム画面を描画する。
 */
function renderHome() {
    renderHomeAlerts();
    renderHomeSummary();
    renderHomeFilter();
    renderHomeList();
}

/**
 * ホーム上部の警告・お知らせを描画する。
 */
function renderHomeAlerts() {
    const leftBehind = getLeftBehindCodes();
    const danger = $('home-alert-danger');
    danger.hidden = leftBehind.length === 0;
    if (leftBehind.length > 0) {
        $('home-alert-danger-title').textContent = `車内に残っている可能性がある子が ${leftBehind.length}人 います`;
        $('home-alert-danger-names').textContent = leftBehind.map((code) => app.rosterMap[code].name).join('、');
    }

    // 運行中（降車点呼をまだしていない）のバスの人数
    const onBusByCourse = {};
    app.roster.forEach((child) => {
        const childState = getChildState(child.code);
        if (childState.status === 'onBus' && !childState.leftBehind) {
            onBusByCourse[child.course] = (onBusByCourse[child.course] || 0) + 1;
        }
    });
    const courseTexts = Object.keys(onBusByCourse).map((course) => `${COURSES[course]} ${onBusByCourse[course]}人`);
    $('home-alert-bus').hidden = courseTexts.length === 0;
    $('home-alert-bus-text').textContent = `バスに乗車中：${courseTexts.join(' ／ ')}（園に着いたら「バス降車」の点呼をしてください）`;
}

/**
 * 状態ごとの人数を描画する。
 */
function renderHomeSummary() {
    const counts = {};
    STATUS_ORDER.forEach((key) => {
        counts[key] = 0;
    });
    app.roster.forEach((child) => {
        counts[getChildState(child.code).status] += 1;
    });

    const summary = $('home-summary');
    clearChildren(summary);
    STATUS_ORDER.forEach((key) => {
        const item = el('div', `summary-item ${STATUS[key].cls}`);
        item.append(el('span', 'summary-label', STATUS[key].label), el('span', 'summary-num', String(counts[key])));
        summary.append(item);
    });
}

/**
 * クラス絞り込みのタブを描画する。
 */
function renderHomeFilter() {
    const tabs = [{ key: 'all', label: 'ぜんいん' }].concat(CLASSES.map((name) => ({ key: name, label: name })));
    const filter = $('home-filter');
    clearChildren(filter);
    tabs.forEach((tab) => {
        const button = el('button', 'filter-tab', tab.label);
        button.type = 'button';
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(app.filter === tab.key));
        button.addEventListener('click', () => {
            app.filter = tab.key;
            renderHomeFilter();
            renderHomeList();
        });
        filter.append(button);
    });
}

/**
 * 園児1人分の一覧の行を作る。
 * @param {Object} child 園児
 * @param {Object} [options] 表示オプション
 * @param {boolean} [options.isNew] 今回新しく追加された子なら true
 * @param {string} [options.time] 表示する時刻（ISO 形式）
 * @param {string} [options.timeLabel] 時刻の前に付ける文字
 * @returns {HTMLElement} li 要素
 */
function createChildItem(child, options) {
    const opts = options || {};
    const childState = getChildState(child.code);
    const status = STATUS[childState.status];

    const item = el('li', `child-item ${status.cls}`);
    if (childState.leftBehind && childState.status === 'onBus') {
        item.classList.add('is-left-behind');
    }
    if (opts.isNew) {
        item.classList.add('is-new');
    }

    const main = el('div', 'child-main');
    main.append(el('span', 'child-name', child.name));

    const time = opts.time !== undefined ? opts.time : childState.updatedAt;
    const timeText = time ? `・${opts.timeLabel || ''}${formatTime(time)}` : '';
    main.append(el('span', 'child-meta', `${child.className}・${COURSES[child.course]}${timeText}`));
    item.append(main);

    if (opts.isNew) {
        item.append(el('span', 'new-badge', 'NEW'));
    }
    if (opts.hideBadge !== true) {
        const badgeText = item.classList.contains('is-left-behind') ? '車内の可能性' : status.label;
        item.append(el('span', `status-badge ${status.cls}`, badgeText));
    }
    return item;
}

/**
 * 園児一覧を描画する。
 */
function renderHomeList() {
    const list = $('home-list');
    clearChildren(list);
    const children = app.roster.filter((child) => app.filter === 'all' || child.className === app.filter);
    if (children.length === 0) {
        list.append(el('li', 'empty', '該当する園児はいません'));
        return;
    }
    children.forEach((child) => list.append(createChildItem(child)));
}

/* =========================================================
   点呼開始画面
   ========================================================= */

/**
 * 点呼の対象になる園児のコード一覧を返す。
 * @param {string} type 点呼の種類（ROLLCALL_TYPES のキー）
 * @param {string|null} course バスのコース
 * @returns {string[]} コード一覧
 */
function getTargetCodes(type, course) {
    const rule = ROLLCALL_TYPES[type];
    return app.roster
        .filter((child) => getChildState(child.code).status === rule.from)
        .filter((child) => !rule.needsCourse || child.course === course)
        .map((child) => child.code);
}

/**
 * 点呼開始画面を最初の状態にして表示する。
 */
function openStartScreen() {
    app.startType = null;
    app.startCourse = null;
    renderStart();
    showScreen('screen-start');
}

/**
 * 点呼開始画面を描画する。
 */
function renderStart() {
    const types = $('start-types');
    clearChildren(types);
    Object.keys(ROLLCALL_TYPES).forEach((key) => {
        const type = ROLLCALL_TYPES[key];
        const button = el('button', 'choice');
        button.type = 'button';
        button.setAttribute('aria-pressed', String(app.startType === key));
        button.append(el('span', 'choice-icon', type.icon), el('span', 'choice-label', type.label));
        button.addEventListener('click', () => {
            app.startType = key;
            if (!type.needsCourse) {
                app.startCourse = null;
            }
            renderStart();
        });
        types.append(button);
    });

    const needsCourse = app.startType !== null && ROLLCALL_TYPES[app.startType].needsCourse;
    $('start-course-area').hidden = !needsCourse;

    const courses = $('start-courses');
    clearChildren(courses);
    BUS_COURSES.forEach((key) => {
        const button = el('button', 'choice');
        button.type = 'button';
        button.setAttribute('aria-pressed', String(app.startCourse === key));
        button.append(el('span', 'choice-label', COURSES[key]));
        button.addEventListener('click', () => {
            app.startCourse = key;
            renderStart();
        });
        courses.append(button);
    });

    // 対象者のプレビュー
    const preview = $('start-preview');
    clearChildren(preview);
    const ready = app.startType !== null && (!needsCourse || app.startCourse !== null);
    let targets = [];
    if (ready) {
        targets = getTargetCodes(app.startType, app.startCourse);
        const rule = ROLLCALL_TYPES[app.startType];
        if (targets.length === 0) {
            preview.append(el('p', 'msg-warn', `対象の園児がいません（「${STATUS[rule.from].label}」の子がいません）`));
        } else {
            const head = el('p');
            head.append('対象の園児 ', el('strong', '', `${targets.length}人`));
            preview.append(head, el('p', 'child-meta', targets.map((code) => app.rosterMap[code].name).join('、')));
        }
    }
    $('btn-begin-session').disabled = !ready || targets.length === 0;
}

/**
 * 選んだ内容で点呼を開始する。
 */
function beginSession() {
    const targets = getTargetCodes(app.startType, app.startCourse);
    app.session = {
        date: todayKey(),
        type: app.startType,
        course: app.startCourse,
        startedAt: new Date().toISOString(),
        targets,
        confirmed: [],
        lastAdded: [],
        lastMessages: [],
    };
    saveData(STORAGE_KEYS.session, app.session);
    renderSession();
    showScreen('screen-session');
}

/* =========================================================
   点呼中画面
   ========================================================= */

/**
 * 点呼の見出し（例: Aコース バス降車）を返す。
 * @param {string} type 点呼の種類
 * @param {string|null} course コース
 * @returns {string} 見出し
 */
function sessionTitle(type, course) {
    const label = ROLLCALL_TYPES[type].label;
    return course ? `${COURSES[course]} ${label}` : label;
}

/**
 * 点呼中画面を描画する。
 */
function renderSession() {
    const session = app.session;
    const confirmedCodes = session.confirmed.map((item) => item.code);
    const leftCodes = session.targets.filter((code) => !confirmedCodes.includes(code));

    $('session-label').textContent = `${ROLLCALL_TYPES[session.type].icon} ${sessionTitle(session.type, session.course)}`;
    $('session-count-done').textContent = String(confirmedCodes.length);
    $('session-count-left').textContent = String(leftCodes.length);
    $('session-count-left').parentElement.classList.toggle('has-left', leftCodes.length > 0);

    // まだ確認できていない子
    const left = $('session-left');
    clearChildren(left);
    if (leftCodes.length === 0) {
        left.append(el('li', 'empty', '対象の子は全員確認できました'));
    } else {
        leftCodes.forEach((code) => left.append(el('li', 'name-chip', app.rosterMap[code].name)));
    }

    // 確認済み（新しく追加した子を上に）
    const done = $('session-done');
    clearChildren(done);
    if (session.confirmed.length === 0) {
        done.append(el('li', 'empty', '「読み取る」を押して名札を読み取ってください'));
    } else {
        session.confirmed.slice().reverse().forEach((item) => {
            done.append(createChildItem(app.rosterMap[item.code], {
                isNew: session.lastAdded.includes(item.code),
                time: item.time,
                timeLabel: '読取 ',
                hideBadge: true,
            }));
        });
    }

    renderReadResult($('session-result'), session.lastMessages);
}

/**
 * 読み取り結果のメッセージ欄を描画する。
 * @param {HTMLElement} box 表示先
 * @param {Array<{type: string, text: string}>} messages メッセージ（type: ok / warn / error）
 */
function renderReadResult(box, messages) {
    clearChildren(box);
    box.hidden = !messages || messages.length === 0;
    if (box.hidden) {
        return;
    }
    box.append(el('p', 'read-result-title', '今回の読み取り結果'));
    const list = el('ul');
    messages.forEach((message) => list.append(el('li', `msg-${message.type}`, message.text)));
    box.append(list);
}

/**
 * 点呼の対象外になっている理由を返す。
 * @param {string} code 園児のコード
 * @returns {string} 理由
 */
function nonTargetReason(code) {
    const child = app.rosterMap[code];
    const childState = getChildState(code);
    const rule = ROLLCALL_TYPES[app.session.type];
    if (childState.status === 'absent') {
        return '欠席連絡があります';
    }
    if (rule.needsCourse && child.course !== app.session.course) {
        return `${COURSES[child.course]}の園児です`;
    }
    return `今の状態が「${STATUS[childState.status].label}」です`;
}

/**
 * リーダーの読み取り画面に表示する、コード → 園児名の対応表を作る。
 * @returns {Object<string,string>} 対応表
 */
function buildDisplayData() {
    const map = {};
    app.roster.forEach((child) => {
        map[child.code] = child.name;
    });
    return map;
}

/**
 * 「読み取る」を押したときの処理。
 * 読み取ったコードを照合し、確認済みに積み上げる。
 */
async function handleSessionRead() {
    const session = app.session;
    const result = await readCodes({
        displayData: buildDisplayData(),
        labelText: `${sessionTitle(session.type, session.course)}：名札を読み取って「完了」を押してください`,
    });

    if (!result.ok) {
        session.lastAdded = [];
        session.lastMessages = [{ type: 'error', text: '読み取りに失敗しました。もう一度「読み取る」を押してください。' }];
        saveData(STORAGE_KEYS.session, session);
        renderSession();
        return;
    }

    // 1回の読み取りの中での重複を取り除く
    const codes = Array.from(new Set(result.codes));
    const messages = [];
    const added = [];
    const now = new Date().toISOString();

    if (codes.length === 0) {
        messages.push({ type: 'warn', text: 'コードが読み取れませんでした。' });
    }

    for (const code of codes) {
        const child = app.rosterMap[code];
        if (!child) {
            messages.push({ type: 'error', text: `登録されていないコードです（コード: ${code}）` });
            continue;
        }
        if (session.confirmed.some((item) => item.code === code)) {
            messages.push({ type: 'warn', text: `${child.name}：すでに確認済みです` });
            continue;
        }
        if (!session.targets.includes(code)) {
            // 対象外の子は、追加するかを1人ずつ先生に確認する
            const reason = nonTargetReason(code);
            const ok = await confirmDialog(`${childLabel(code)} は対象外の園児です。\n理由：${reason}\n\n確認済みに追加しますか？`, '追加する');
            if (!ok) {
                messages.push({ type: 'warn', text: `${child.name}：対象外のため追加しませんでした（${reason}）` });
                continue;
            }
            messages.push({ type: 'warn', text: `${child.name}：対象外ですが追加しました（${reason}）` });
        }
        session.confirmed.push({ code, time: now });
        added.push(code);
    }

    if (added.length > 0) {
        messages.unshift({ type: 'ok', text: `${added.length}人を確認済みに追加しました` });
    }

    session.lastAdded = added;
    session.lastMessages = messages;
    saveData(STORAGE_KEYS.session, session);
    renderSession();
    window.scrollTo(0, 0);
}

/**
 * 「確定」を押したときの処理。
 * 状態を更新して点呼記録を保存する。バス降車で未確認の子がいれば警告画面へ進む。
 */
async function handleSessionFinish() {
    const session = app.session;
    const rule = ROLLCALL_TYPES[session.type];
    const confirmedCodes = session.confirmed.map((item) => item.code);
    const leftCodes = session.targets.filter((code) => !confirmedCodes.includes(code));

    if (session.confirmed.length === 0 && leftCodes.length === 0) {
        await alertDialog('確認済みの子がいません。');
        return;
    }

    if (leftCodes.length > 0) {
        const names = leftCodes.map((code) => app.rosterMap[code].name).join('、');
        const ok = await confirmDialog(`未確認の子が ${leftCodes.length}人 います。確定しますか？\n\n${names}`, '確定する', 'btn-accent');
        if (!ok) {
            return;
        }
    }

    const record = {
        id: `r${Date.now()}`,
        date: session.date,
        time: new Date().toISOString(),
        type: session.type,
        course: session.course,
        targets: session.targets,
        confirmed: session.confirmed,
        unconfirmed: leftCodes,
        found: [],
    };

    // 確認できた子の状態を変える
    session.confirmed.forEach((item) => setChildStatus(item.code, rule.to, item.time));

    // バス降車で確認できなかった子は「置き去りの可能性あり」にする
    if (session.type === 'alight') {
        leftCodes.forEach((code) => {
            const childState = getChildState(code);
            childState.leftBehind = true;
            childState.leftBehindRecordId = record.id;
        });
    }

    saveState();
    const records = loadData(STORAGE_KEYS.records, []);
    records.push(record);
    saveData(STORAGE_KEYS.records, records);
    removeData(STORAGE_KEYS.session);
    app.session = null;

    if (session.type === 'alight' && leftCodes.length > 0) {
        openWarningScreen();
        return;
    }
    showToast(`${sessionTitle(session.type, session.course)}の点呼を確定しました`);
    renderHome();
    showScreen('screen-home');
}

/**
 * 「中止」を押したときの処理。
 */
async function handleSessionCancel() {
    const ok = await confirmDialog('点呼を中止しますか？\n読み取った内容は記録されません。', '中止する', 'btn-danger');
    if (!ok) {
        return;
    }
    removeData(STORAGE_KEYS.session);
    app.session = null;
    renderHome();
    showScreen('screen-home');
}

/* =========================================================
   置き去り警告画面
   ========================================================= */

/**
 * 置き去り警告画面を開く（今、置き去りの可能性がある子を表示する）。
 */
function openWarningScreen() {
    app.warningCodes = getLeftBehindCodes();
    renderReadResult($('warning-result'), []);
    renderWarning();
    showScreen('screen-warning');
}

/**
 * 置き去り警告画面を描画する。
 */
function renderWarning() {
    const list = $('warning-list');
    clearChildren(list);

    app.warningCodes.forEach((code) => {
        const child = app.rosterMap[code];
        const childState = getChildState(code);
        const isFound = !childState.leftBehind;

        const item = el('li', `warning-item${isFound ? ' is-found' : ''}`);
        const main = el('div', 'child-main');
        main.append(el('span', 'child-name', child.name), el('span', 'child-meta', `${child.className}・${COURSES[child.course]}`));
        item.append(main);

        if (isFound) {
            item.append(el('span', 'found-label', `✓ 発見済み ${formatTime(childState.updatedAt)}`));
        } else {
            const button = el('button', 'btn btn-danger', '発見済み');
            button.type = 'button';
            button.addEventListener('click', async () => {
                const ok = await confirmDialog(`${child.name} さんを見つけましたか？\n「園内」に変更します。`, '見つけた', 'btn-accent');
                if (ok) {
                    markFound(code, 'button');
                    afterFound();
                }
            });
            item.append(button);
        }
        list.append(item);
    });
}

/**
 * 置き去りの可能性があった子を「発見済み（園内）」にする。
 * @param {string} code 園児のコード
 * @param {string} method 確認方法（read: 読み取り / button: ボタン）
 */
function markFound(code, method) {
    const childState = getChildState(code);
    const recordId = childState.leftBehindRecordId;
    const now = new Date().toISOString();
    setChildStatus(code, 'inSchool', now);
    saveState();

    // 元の点呼記録に「あとから見つかった」ことを残す
    const records = loadData(STORAGE_KEYS.records, []);
    const record = records.find((item) => item.id === recordId);
    if (record) {
        record.found.push({ code, time: now, method });
        saveData(STORAGE_KEYS.records, records);
    }
}

/**
 * 発見済みにしたあとの再描画と、全員見つかったときのお知らせ。
 */
function afterFound() {
    renderWarning();
    if (getLeftBehindCodes().length === 0) {
        showToast('全員の確認ができました');
    }
}

/**
 * 警告画面で「見つけた子を読み取る」を押したときの処理。
 */
async function handleWarningRead() {
    const result = await readCodes({
        displayData: buildDisplayData(),
        labelText: '車内確認：見つけた子の名札を読み取って「完了」を押してください',
    });
    if (!result.ok) {
        renderReadResult($('warning-result'), [{ type: 'error', text: '読み取りに失敗しました。もう一度お試しください。' }]);
        return;
    }

    const messages = [];
    const codes = Array.from(new Set(result.codes));
    if (codes.length === 0) {
        messages.push({ type: 'warn', text: 'コードが読み取れませんでした。' });
    }
    codes.forEach((code) => {
        const child = app.rosterMap[code];
        if (!child) {
            messages.push({ type: 'error', text: `登録されていないコードです（コード: ${code}）` });
            return;
        }
        const childState = getChildState(code);
        if (childState.leftBehind && childState.status === 'onBus') {
            markFound(code, 'read');
            messages.push({ type: 'ok', text: `${child.name}：発見済みにしました` });
        } else if (app.warningCodes.includes(code)) {
            messages.push({ type: 'warn', text: `${child.name}：すでに発見済みです` });
        } else {
            messages.push({ type: 'warn', text: `${child.name}：車内確認の対象ではありません` });
        }
    });

    renderReadResult($('warning-result'), messages);
    afterFound();
}

/* =========================================================
   欠席連絡画面
   ========================================================= */

/**
 * 欠席連絡画面を最初の状態にして表示する。
 */
function openAbsenceScreen() {
    resetAbsenceForm();
    renderAbsenceList();
    showScreen('screen-absence');
}

/**
 * 欠席連絡フォームの選択肢を用意する（起動時に1回だけ）。
 */
function setupAbsenceForm() {
    const select = $('absence-child');
    select.append(new Option('選択してください', ''));
    app.roster.forEach((child) => select.append(new Option(childLabel(child.code), child.code)));

    const reasons = $('absence-reasons');
    ABSENCE_REASONS.forEach((reason) => {
        const label = el('label', 'radio-option');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'absence-reason';
        input.value = reason;
        input.addEventListener('change', updateTempVisibility);
        label.append(input, el('span', '', reason));
        reasons.append(label);
    });

    $('absence-memo').addEventListener('input', updateMemoCounter);
    $('absence-form').addEventListener('submit', handleAbsenceSubmit);
}

/**
 * 欠席連絡フォームを空に戻す。
 */
function resetAbsenceForm() {
    $('absence-form').reset();
    $('absence-date').value = todayKey();
    $('absence-date').min = todayKey();
    clearAbsenceErrors();
    updateTempVisibility();
    updateMemoCounter();
}

/**
 * 選択されている欠席理由を返す。
 * @returns {string} 欠席理由（未選択なら空文字）
 */
function selectedReason() {
    const checked = document.querySelector('input[name="absence-reason"]:checked');
    return checked ? checked.value : '';
}

/**
 * 欠席理由が「体調不良」のときだけ体温の入力欄を表示する。
 */
function updateTempVisibility() {
    $('absence-temp-group').hidden = selectedReason() !== '体調不良';
}

/**
 * メモの残り文字数を表示する。
 */
function updateMemoCounter() {
    const length = Array.from($('absence-memo').value).length;
    const counter = $('absence-memo-counter');
    const rest = MEMO_MAX_LENGTH - length;
    counter.textContent = rest >= 0 ? `あと${rest}文字` : `${-rest}文字オーバーしています（${MEMO_MAX_LENGTH}文字まで）`;
    counter.classList.toggle('is-over', rest < 0);
}

/**
 * 入力エラーの表示を消す。
 */
function clearAbsenceErrors() {
    ['absence-child', 'absence-date', 'absence-reason', 'absence-temp', 'absence-memo'].forEach((id) => {
        const error = $(`${id}-error`);
        error.hidden = true;
        error.textContent = '';
        const control = $(id);
        if (control) {
            control.classList.remove('is-invalid');
        }
    });
}

/**
 * 入力エラーを表示する。
 * @param {string} id 項目の id
 * @param {string} message エラーメッセージ
 */
function showAbsenceError(id, message) {
    const error = $(`${id}-error`);
    error.textContent = message;
    error.hidden = false;
    const control = $(id);
    if (control) {
        control.classList.add('is-invalid');
    }
}

/**
 * 欠席連絡の入力内容をチェックする。
 * @returns {Object|null} 問題がなければ保存する内容、問題があれば null
 */
function validateAbsenceForm() {
    clearAbsenceErrors();
    const code = $('absence-child').value;
    const date = $('absence-date').value;
    const reason = selectedReason();
    const tempText = $('absence-temp').value.trim();
    const memo = $('absence-memo').value;
    let valid = true;

    if (!code || !app.rosterMap[code]) {
        showAbsenceError('absence-child', '園児を選択してください');
        valid = false;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        showAbsenceError('absence-date', '欠席する日を入力してください');
        valid = false;
    } else if (date < todayKey()) {
        showAbsenceError('absence-date', '過去の日付は登録できません');
        valid = false;
    }

    // 今日の欠席は、まだ登園・乗車していない子だけ登録できる
    if (valid && date === todayKey()) {
        const status = getChildState(code).status;
        if (status !== 'notArrived' && status !== 'absent') {
            showAbsenceError('absence-child', `この子はすでに登園・乗車しています（今の状態：${STATUS[status].label}）`);
            valid = false;
        }
    }

    if (!ABSENCE_REASONS.includes(reason)) {
        showAbsenceError('absence-reason', '欠席理由を選択してください');
        valid = false;
    }

    let temperature = null;
    if (reason === '体調不良' && tempText !== '') {
        // 全角数字で入力されても受け付ける
        const normalized = tempText.replace(/[０-９．]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
        if (!/^\d{2}(\.\d)?$/.test(normalized)) {
            showAbsenceError('absence-temp', '体温は「37.5」のように数字で入力してください（小数第1位まで）');
            valid = false;
        } else {
            temperature = Number(normalized);
            if (temperature < TEMP_MIN || temperature > TEMP_MAX) {
                showAbsenceError('absence-temp', `体温は ${TEMP_MIN.toFixed(1)}〜${TEMP_MAX.toFixed(1)} の範囲で入力してください`);
                valid = false;
            }
        }
    }

    if (Array.from(memo).length > MEMO_MAX_LENGTH) {
        showAbsenceError('absence-memo', `メモは${MEMO_MAX_LENGTH}文字以内で入力してください`);
        valid = false;
    }

    if (!valid) {
        return null;
    }
    return { code, date, reason, temperature, memo: memo.trim() };
}

/**
 * 欠席連絡を保存する。
 * @param {Event} event submit イベント
 */
function handleAbsenceSubmit(event) {
    event.preventDefault();
    const input = validateAbsenceForm();
    if (!input) {
        const firstError = document.querySelector('#absence-form .form-error:not([hidden])');
        if (firstError) {
            firstError.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
    }

    const absences = loadData(STORAGE_KEYS.absences, []);
    // 同じ子・同じ日の連絡があれば上書きする
    const index = absences.findIndex((item) => item.code === input.code && item.date === input.date);
    const absence = Object.assign({ id: `a${Date.now()}`, createdAt: new Date().toISOString() }, input);
    if (index >= 0) {
        absences[index] = absence;
    } else {
        absences.push(absence);
    }
    saveData(STORAGE_KEYS.absences, absences);

    if (input.date === todayKey()) {
        setChildStatus(input.code, 'absent', absence.createdAt);
        saveState();
    }

    showToast(index >= 0 ? '欠席連絡を上書きしました' : '欠席連絡を保存しました');
    resetAbsenceForm();
    renderAbsenceList();
}

/**
 * 登録済みの欠席連絡（今日以降）を描画する。
 */
function renderAbsenceList() {
    const list = $('absence-list');
    clearChildren(list);
    const today = todayKey();
    const absences = loadData(STORAGE_KEYS.absences, [])
        .filter((item) => item.date >= today)
        .sort((a, b) => (a.date === b.date ? Number(a.code) - Number(b.code) : a.date.localeCompare(b.date)));

    if (absences.length === 0) {
        list.append(el('li', 'empty', '登録済みの欠席連絡はありません'));
        return;
    }

    absences.forEach((absence) => {
        const item = el('li', 'record-item');
        const head = el('div', 'record-head');
        head.append(el('span', 'record-time', formatDateLabel(absence.date)), el('span', 'record-title', childLabel(absence.code)));
        item.append(head);

        const tempText = absence.temperature !== null && absence.temperature !== undefined ? `（体温 ${absence.temperature.toFixed(1)}℃）` : '';
        item.append(el('p', 'record-line', `理由：${absence.reason}${tempText}`));
        if (absence.memo) {
            item.append(el('p', 'record-memo', absence.memo));
        }

        const cancel = el('button', 'btn btn-text', 'この連絡を取り消す');
        cancel.type = 'button';
        cancel.addEventListener('click', () => cancelAbsence(absence.id));
        item.append(cancel);
        list.append(item);
    });
}

/**
 * 欠席連絡を取り消す。今日の分なら状態を「未登園」に戻す。
 * @param {string} id 欠席連絡の id
 */
async function cancelAbsence(id) {
    const absences = loadData(STORAGE_KEYS.absences, []);
    const absence = absences.find((item) => item.id === id);
    if (!absence) {
        return;
    }
    const ok = await confirmDialog(`${childLabel(absence.code)} の ${formatDateLabel(absence.date)} の欠席連絡を取り消しますか？`, '取り消す', 'btn-danger');
    if (!ok) {
        return;
    }
    saveData(STORAGE_KEYS.absences, absences.filter((item) => item.id !== id));
    if (absence.date === todayKey() && getChildState(absence.code).status === 'absent') {
        setChildStatus(absence.code, 'notArrived');
        saveState();
    }
    showToast('欠席連絡を取り消しました');
    renderAbsenceList();
}

/* =========================================================
   点呼履歴画面
   ========================================================= */

/**
 * 点呼履歴画面を表示する。
 */
function openHistoryScreen() {
    renderHistory();
    showScreen('screen-history');
}

/**
 * コード一覧を名前の一覧（、区切り）にする。
 * @param {string[]} codes コード一覧
 * @returns {string} 名前の一覧
 */
function namesOf(codes) {
    return codes.map((code) => (app.rosterMap[code] ? app.rosterMap[code].name : `コード ${code}`)).join('、');
}

/**
 * 今日の点呼記録を時系列で描画する。
 */
function renderHistory() {
    const today = todayKey();
    $('history-date').textContent = `${formatDateLabel(today)} の点呼記録`;

    const list = $('history-list');
    clearChildren(list);
    const records = loadData(STORAGE_KEYS.records, []).filter((record) => record.date === today);

    if (records.length === 0) {
        list.append(el('li', 'empty', '今日の点呼記録はまだありません'));
        return;
    }

    records.forEach((record) => {
        const foundCodes = record.found.map((item) => item.code);
        const stillMissing = record.unconfirmed.filter((code) => !foundCodes.includes(code));
        const item = el('li', 'record-item');
        if (record.type === 'alight' && stillMissing.length > 0) {
            item.classList.add('has-problem');
        }

        const head = el('div', 'record-head');
        head.append(
            el('span', 'record-time', formatTime(record.time)),
            el('span', 'record-title', `${ROLLCALL_TYPES[record.type].icon} ${sessionTitle(record.type, record.course)}`)
        );
        item.append(head);

        item.append(el('p', 'record-line', `確認 ${record.confirmed.length}人 ／ 対象 ${record.targets.length}人`));
        if (record.confirmed.length > 0) {
            item.append(el('p', 'record-line child-meta', `確認済み：${namesOf(record.confirmed.map((c) => c.code))}`));
        }
        if (record.unconfirmed.length > 0) {
            item.append(el('p', 'record-line msg-error', `未確認：${namesOf(record.unconfirmed)}`));
        }
        record.found.forEach((found) => {
            const how = found.method === 'read' ? '読み取り' : 'ボタン';
            item.append(el('p', 'record-line msg-ok', `${formatTime(found.time)} 発見：${namesOf([found.code])}（${how}で確認）`));
        });
        list.append(item);
    });
}

/* =========================================================
   リセット・起動
   ========================================================= */

/**
 * 「データをリセット」を押したときの処理。
 */
async function handleReset() {
    const ok = await confirmDialog('すべてのデータ（状態・点呼記録・欠席連絡）を消去します。\nよろしいですか？', '消去する', 'btn-danger');
    if (!ok) {
        return;
    }
    clearAllData();
    ensureToday();
    app.filter = 'all';
    renderHome();
    showScreen('screen-home');
    showToast('データをリセットしました');
}

/**
 * 画面のボタンに処理を割り当てる。
 */
function bindEvents() {
    $('header-back').addEventListener('click', () => {
        renderHome();
        showScreen('screen-home');
    });
    $('btn-start-rollcall').addEventListener('click', openStartScreen);
    $('btn-open-absence').addEventListener('click', openAbsenceScreen);
    $('btn-open-history').addEventListener('click', openHistoryScreen);
    $('btn-reset').addEventListener('click', handleReset);
    $('home-alert-danger').addEventListener('click', openWarningScreen);

    $('btn-begin-session').addEventListener('click', beginSession);
    $('btn-session-read').addEventListener('click', handleSessionRead);
    $('btn-session-finish').addEventListener('click', handleSessionFinish);
    $('btn-session-cancel').addEventListener('click', handleSessionCancel);

    $('btn-warning-read').addEventListener('click', handleWarningRead);
    $('btn-warning-home').addEventListener('click', () => {
        renderHome();
        showScreen('screen-home');
    });

    // アプリを開いたまま日付が変わった場合に備え、画面に戻ってきたときに確認する
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && app.state && app.state.date !== todayKey()) {
            ensureToday();
            renderHome();
            showScreen('screen-home');
        }
    });
}

/**
 * 園児名簿（JSON ファイル）を読み込む。
 * @returns {Promise<Array>} 園児名簿
 */
async function loadRoster() {
    const response = await fetch('data/children.json', { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`名簿の読み込みに失敗しました（${response.status}）`);
    }
    return response.json();
}

/**
 * 園児名簿が読み込めなかったときに、画面全体で原因と対処を案内する。
 * （ボタンが反応しないまま放置されないようにするため）
 */
function showLoadError() {
    const isFile = location.protocol === 'file:';
    const box = el('div', 'load-error');
    box.append(el('p', 'load-error-title', '園児名簿を読み込めませんでした'));

    if (isFile) {
        box.append(
            el('p', '', 'index.html をファイルとして直接開いているため、ブラウザの制限で名簿（data/children.json）を読み込めません。'),
            el('p', '', 'Web サーバー経由（http:// または https:// で始まるアドレス）で開いてください。'),
            el('p', 'load-error-hint', '例：VS Code の「Live Server」で開く／このフォルダで「python -m http.server」を実行して http://localhost:8000/ を開く／GitHub Pages で公開して開く')
        );
    } else {
        box.append(el('p', '', '通信状況を確認して、再読み込みしてください。'));
        const retry = el('button', 'btn btn-primary btn-xl', '再読み込み');
        retry.type = 'button';
        retry.addEventListener('click', () => location.reload());
        box.append(retry);
    }

    document.querySelectorAll('.screen').forEach((screen) => {
        screen.hidden = true;
    });
    const main = document.querySelector('.app-main');
    main.insertBefore(box, main.firstChild);
}

/**
 * アプリを起動する。
 */
async function init() {
    $('header-date').textContent = formatDateLabel(todayKey());
    try {
        app.roster = await loadRoster();
    } catch (error) {
        console.error(error);
        showLoadError();
        return;
    }
    app.roster.forEach((child) => {
        app.rosterMap[child.code] = child;
    });

    ensureToday();
    setupAbsenceForm();
    bindEvents();

    // 途中の点呼があれば続きから再開する
    if (app.session) {
        renderSession();
        showScreen('screen-session');
        showToast('途中の点呼を再開しました');
        return;
    }
    renderHome();
    showScreen('screen-home');
}

document.addEventListener('DOMContentLoaded', init);
