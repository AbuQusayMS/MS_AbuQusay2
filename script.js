/* =========================================================
       المرحلة ١: الأساسيات والنواة (تهيئة، أدوات عامة، ربط أولي)
       ========================================================= */

    /* رموز الواجهة */
    const ICON_SUN  = '\u2600\uFE0F';
    const ICON_MOON = '\uD83C\uDF19';

    /* الفئة الرئيسية للّعبة */
    class QuizGame {
        /* ————————————————— إعداد عام ————————————————— */
        constructor() {
            // إعدادات التطبيق والتكامل
            this.config = {
                SUPABASE_URL: 'https://ckbphyndplaihlfdypyi.supabase.co',
                SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrYnBoeW5kcGxhaWhsZmR5cHlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA1MjI3MjQsImV4cCI6MjA3NjA5ODcyNH0.waA1ZU5pU3n-d7VHn18MQ8J7qVPT9mz1udKUeEjcydI',
                EDGE_SAVE_URL: 'https://ckbphyndplaihlfdypyi.supabase.co/functions/v1/saveResult',
                EDGE_REPORT_URL: 'https://ckbphyndplaihlfdypyi.supabase.co/functions/v1/report',
                EDGE_LOG_URL: 'https://ckbphyndplaihlfdypyi.supabase.co/functions/v1/clientLog',
                APP_KEY: 'MS_AbuQusay',
                QUESTIONS_URL: 'https://abuqusayms.github.io/MS_AbuQusay/questions.json',

                QUESTION_TIME: 80,
                MAX_WRONG_ANSWERS: 3,
                STARTING_SCORE: 100,

                LEVELS: [
                    { name: 'easy',       label: 'سهل' },
                    { name: 'medium',     label: 'متوسط' },
                    { name: 'hard',       label: 'صعب' },
                    { name: 'impossible', label: 'مستحيل' }
                ],

                HELPER_COSTS: { fiftyFifty: 100, freezeTime: 100, skipQuestionBase: 0, skipQuestionIncrement: 0 },
                SKIP_WEIGHT: 0.7,

                CLICK_DEBOUNCE_MS: 600,
                COOLDOWN_SECONDS: 30,
                REQ_TIMEOUT_MS: 10000
            };

            // حالة داخلية
            this.supabase = null;
            this.questions = {};
            this.gameState = {};
            this.timer = { interval: null, isFrozen: false, total: 0 };
            this.dom = {};
            this.cropper = null;
            this.leaderboardSubscription = null;
            this.recentErrors = [];
            this.audioCache = new Map();
            this.currentSessionId = this.generateSessionId();
            this.cleanupQueue = [];
            this.answerSubmitted = false;
            this.pendingRequests = new Set();
            this.lbFirstOpenDone = false;
            this.idempotency = new Set();
            this.lastActionAt = new Map();

            // تشغيل أولي
            this.setupErrorHandling();
            this.setupBackButtonHandler();
            this.init();
        }

        /* ———— أداة نداء دوال Supabase ———— */
        edgeFetch(path, payload, { method = 'POST', signal } = {}) {
            const url = `${this.config.SUPABASE_URL}/functions/v1/${path}`;
            return fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.SUPABASE_KEY}`, // anon key
                    'apikey': this.config.SUPABASE_KEY,
                    'x-app-key': this.config.APP_KEY
                },
                body: method === 'POST' ? JSON.stringify(payload || {}) : undefined,
                referrerPolicy: 'no-referrer',
                signal
            });
        }

        /* ———————————————— أدوات DOM ———————————————— */
        cacheDomElements() {
            const byId = (id) => document.getElementById(id);
            this.dom = {
                screens: {
                    loader: byId('loader'),
                    start: byId('startScreen'),
                    avatar: byId('avatarScreen'),
                    nameEntry: byId('nameEntryScreen'),
                    instructions: byId('instructionsScreen'),
                    game: byId('gameContainer'),
                    levelComplete: byId('levelCompleteScreen'),
                    end: byId('endScreen'),
                    leaderboard: byId('leaderboardScreen')
                },
                modals: {
                    confirmExit: byId('confirmExitModal'),
                    advancedReport: byId('advancedReportModal'),
                    avatarEditor: byId('avatarEditorModal'),
                    playerDetails: byId('playerDetailsModal')
                },
                nameInput: byId('nameInput'),
                nameError: byId('nameError'),
                confirmNameBtn: byId('confirmNameBtn'),
                confirmAvatarBtn: byId('confirmAvatarBtn'),
                reportProblemForm: byId('reportProblemForm'),
                imageToCrop: byId('image-to-crop'),
                leaderboardContent: byId('leaderboardContent'),
                questionText: byId('questionText'),
                optionsGrid: this.getEl('.options-grid'),
                scoreDisplay: byId('currentScore'),
                reportFab: byId('reportErrorFab'),
                problemScreenshot: byId('problemScreenshot'),
                reportImagePreview: byId('reportImagePreview'),
                includeAutoDiagnostics: byId('includeAutoDiagnostics'),
                lbMode: byId('lbMode'),
                lbAttempt: byId('lbAttempt'),
                retryHint: byId('retryHint'),
                retryCountdown: byId('retryCountdown')
            };
        }
        getEl(selector, parent = document) { return parent.querySelector(selector); }
        getAllEl(selector, parent = document) { return Array.from(parent.querySelectorAll(selector)); }

        /* ———————————————— ربط الأحداث العامة ———————————————— */
        bindEventListeners() {
            document.body.addEventListener('click', (e) => {
                const target = e.target.closest('[data-action]');
                if (!target) return;
                const action = target.dataset.action;

                const actionHandlers = {
                    showAvatarScreen:        () => this.startFromHomeGuarded(target),
                    showNameEntryScreen:     () => this.showScreen('nameEntry'),
                    confirmName:             () => this.handleNameConfirmation(),
                    postInstructionsStart:   () => this.postInstructionsStartGuarded(target),
                    showLeaderboard:         () => this.displayLeaderboard(),
                    showStartScreen:         () => this.showScreen('start'),
                    toggleTheme:             () => this.toggleTheme(),
                    showConfirmExitModal:    () => this.showModal('confirmExit'),
                    closeModal:              () => {
                        const id = target.dataset.modalId || target.dataset.modalKey;
                        if (id === 'avatarEditor' || id === 'avatarEditorModal') this.cleanupAvatarEditor();
                        this.hideModal(id);
                    },
                    endGame:                 () => this.endGame(),
                    nextLevel:               () => this.nextLevel(),
                    playAgain:               () => this.playAgainGuarded(target),
                    shareOnX:                () => this.shareOnX(),
                    shareOnInstagram:        () => this.shareOnInstagram(),
                    saveCroppedAvatar:       () => this.saveCroppedAvatar()
                };

                if (!this.guardAction(target, action)) return;
                if (actionHandlers[action]) {
                    this.playSound('click');
                    actionHandlers[action]();
                }
            });

            // إدخال الاسم
            this.dom.nameInput?.addEventListener('input', () => this.validateNameInput());
            this.dom.nameInput?.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.handleNameConfirmation(); });

            // نموذج البلاغ
            this.dom.reportProblemForm?.addEventListener('submit', (e) => this.handleReportSubmitGuarded(e));

            // خيارات السؤال
            if (this.dom.optionsGrid) {
                this.dom.optionsGrid.addEventListener('click', (e) => {
                    const btn = e.target.closest('.option-btn');
                    if (!btn) return;
                    this.getAllEl('.option-btn').forEach(b => b.classList.add('disabled'));
                    this.checkAnswer(btn);
                });
            }

            // أزرار المساعدات
            const helpersEl = this.getEl('.helpers');
            if (helpersEl) {
                helpersEl.addEventListener('click', (e) => {
                    const btn = e.target.closest('.helper-btn');
                    if (btn) this.useHelper(btn);
                });
            }

            // شبكة الصور الرمزية
            const avatarGrid = this.getEl('.avatar-grid');
            if (avatarGrid) {
                avatarGrid.addEventListener('click', (e) => {
                    if (e.target.matches('.avatar-option')) this.selectAvatar(e.target);
                });
            }

            this.dom.reportFab?.addEventListener('click', () => this.showModal('advancedReport'));

            // إغلاق النوافذ بالنقر خارج المحتوى
            document.querySelectorAll('.modal').forEach(modal => {
                modal.addEventListener('click', (e) => { if (e.target.classList.contains('modal')) modal.classList.remove('active'); });
            });

            // عرض معاينة صورة البلاغ
            this.dom.problemScreenshot?.addEventListener('change', (e) => {
                const file = e.target.files?.[0];
                const prev = this.dom.reportImagePreview;
                if (!prev) return;
                if (!file) { prev.style.display = 'none'; prev.querySelector('img')?.setAttribute('src',''); return; }
                const url = URL.createObjectURL(file);
                prev.style.display = 'block';
                prev.querySelector('img')?.setAttribute('src', url);
            });

            // زر الهروب
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    const open = document.querySelector('.modal.active');
                    if (open) open.classList.remove('active');
                }
            });

            // لوحة الصدارة: تبديل الوضع/المحاولة
            this.dom.lbMode?.addEventListener('change', () => {
                const m = this.dom.lbMode.value;
                if (this.dom.lbAttempt) this.dom.lbAttempt.disabled = (m !== 'attempt');
                this.displayLeaderboard();
            });
            this.dom.lbAttempt?.addEventListener('change', () => this.displayLeaderboard());
        }

        /* ———————————————— تحميل الأصوات ———————————————— */
        async preloadAudio() {
            const audioFiles = {
                correct: '/MS_AbuQusay/audio/correct.mp3',
                wrong: '/MS_AbuQusay/audio/wrong.mp3',
                levelup: '/MS_AbuQusay/audio/levelup.mp3',
                win: '/MS_AbuQusay/audio/win.mp3',
                loss: '/MS_AbuQusay/audio/loss.mp3',
                start: '/MS_AbuQusay/audio/start.mp3',
                click: '/MS_AbuQusay/audio/ui-click.mp3',
                notify: '/MS_AbuQusay/audio/notify.mp3',
                coin: '/MS_AbuQusay/audio/coin.mp3',
                fadeout: '/MS_AbuQusay/audio/fadeout.mp3',
                whoosh: '/MS_AbuQusay/audio/whoosh.mp3'
            };
            for (const [key, path] of Object.entries(audioFiles)) {
                try {
                    const audio = new Audio();
                    audio.preload = 'auto';
                    audio.src = path;
                    this.audioCache.set(key, audio);
                } catch (_) {}
            }
        }
        playSound(name) {
            try {
                const audio = this.audioCache.get(name);
                if (audio) { const c = audio.cloneNode(); c.volume = 0.7; c.play().catch(()=>{}); }
            } catch(_) {}
        }

        /* ———————————————— حراسة النقرات وإرسال خلفي ———————————————— */
        generateSessionId() { return `S${Date.now()}_${Math.random().toString(36).substring(2, 11)}`; }

        guardAction(target, actionName, extraMs = 0) {
            const now = Date.now();
            const prev = this.lastActionAt.get(actionName) || 0;
            if (now - prev < this.config.CLICK_DEBOUNCE_MS + extraMs) return false;
            this.lastActionAt.set(actionName, now);

            if (target) {
                if (target.dataset.busy === '1') return false;
                target.dataset.busy = '1';
                target.setAttribute('aria-disabled', 'true');
                target.classList.add('is-busy');
                setTimeout(() => {
                    target.dataset.busy = '0';
                    target.removeAttribute('aria-disabled');
                    target.classList.remove('is-busy');
                }, this.config.CLICK_DEBOUNCE_MS + extraMs);
            }
            return true;
        }

        /* ———————————————— معالجة الأخطاء وزر الرجوع ———————————————— */
        setupErrorHandling() {
            window.addEventListener('error', (ev) => {
                this.recentErrors.push({
                    type: 'error',
                    message: String(ev.message || ''),
                    source: ev.filename || '',
                    line: ev.lineno || 0,
                    col: ev.colno || 0,
                    time: new Date().toISOString()
                });
                this.recentErrors = this.recentErrors.slice(-10);
                this.sendClientLog && this.sendClientLog('client-error', this.recentErrors.at(-1));
            });
            window.addEventListener('unhandledrejection', (ev) => {
                this.recentErrors.push({
                    type: 'unhandledrejection',
                    reason: String(ev.reason || ''),
                    time: new Date().toISOString()
                });
                this.recentErrors = this.recentErrors.slice(-10);
                this.sendClientLog && this.sendClientLog('client-error', this.recentErrors.at(-1));
            });
        }

        setupBackButtonHandler() {
            window.addEventListener('popstate', () => { this.handleBackButton(); });
            this.originalPushState = history.pushState;
            history.pushState = (...args) => { this.originalPushState.apply(history, args); this.currentState = args[0]; };
        }
        handleBackButton() {
            const activeScreen = this.getEl('.screen.active');
            if (!activeScreen) return;
            const screenId = activeScreen.id;

            switch (screenId) {
                case 'startScreen': break;
                case 'avatarScreen':
                case 'nameEntryScreen':
                case 'instructionsScreen':
                    if (screenId === 'instructionsScreen') this.showScreen('nameEntry');
                    else if (screenId === 'nameEntryScreen') this.showScreen('avatar');
                    else if (screenId === 'avatarScreen') this.showScreen('start');
                    break;
                case 'gameContainer': this.showModal('confirmExit'); break;
                case 'levelCompleteScreen':
                case 'endScreen':
                case 'leaderboardScreen': this.showScreen('start'); break;
                default:
                    const openModal = document.querySelector('.modal.active');
                    if (openModal) this.hideModal(openModal.id); else this.showScreen('start');
            }
        }

        /* ———————————————— تهيئة أولية ———————————————— */
        async init() {
            this.cacheDomElements();
            this.bindEventListeners();
            this.populateAvatarGrid();
            await this.preloadAudio();

            // ✅ تهيئة supabase-js للاستخدام في الواجهة (قراءة leaderboard، رفع صور البلاغات، …)
            try {
                const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
                this.supabase = createClient(this.config.SUPABASE_URL, this.config.SUPABASE_KEY, { auth: { persistSession: false } });
            } catch (e) {
                console.error('Supabase init failed:', e);
                this.showToast('تعذّرت تهيئة الاتصال بالخادم.', 'error');
            }

            // إعادة إرسال مؤجّل
            await this.retryFailedSubmissions();

            // تحميل الأسئلة
            const ok = await this.loadQuestions();
            if (ok) this.showScreen('start');
            else {
                const lt = this.getEl('#loaderText');
                if (lt) lt.textContent = 'حدث خطأ في تحميل الأسئلة. الرجاء تحديث الصفحة.';
            }
            this.dom.screens.loader?.classList.remove('active');
        }

        /* ———————————————— ظهور/إخفاء الشاشات والنوافذ ———————————————— */
        showScreen(screenName) {
            Object.values(this.dom.screens).forEach(s => s?.classList?.remove('active'));
            const el = this.dom.screens[screenName];
            if (el) {
                el.classList.add('active');
                const id = el.id;
                if (['gameContainer','leaderboardScreen','endScreen'].includes(id)) {
                    history.pushState({ screen: id }, '', `#${id}`);
                }
                // ✅ ابدأ عداد قفل زر البداية عند فتح شاشة البداية
                if (screenName === 'start') this.startStartCooldownUI();
            }
        }

        showModal(nameOrId) { (this.dom.modals[nameOrId] || document.getElementById(nameOrId))?.classList.add('active'); }
        hideModal(nameOrId) { (this.dom.modals[nameOrId] || document.getElementById(nameOrId))?.classList.remove('active'); }

        /* ———————————————— تنبيهات قصيرة ———————————————— */
        showToast(message, type = 'info') {
            const c = this.getEl('#toast-container'); if (!c) return;
            const t = document.createElement('div');
            t.className = `toast ${type}`; t.textContent = message; t.setAttribute('role','alert');
            c.appendChild(t); setTimeout(() => t.remove(), 3000);
        }

        /* ———————————————— مظهر الواجهة ———————————————— */
        toggleTheme() {
            const newTheme = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
            document.body.dataset.theme = newTheme;
            localStorage.setItem('theme', newTheme);
            this.getEl('.theme-toggle-btn').textContent = (newTheme === 'dark') ? ICON_SUN : ICON_MOON;
        }
        updateLevelProgressUI() {
            this.getAllEl('.level-indicator').forEach((ind, i) => {
                ind.classList.toggle('active', i === this.gameState.level);
                ind.classList.toggle('completed', i < this.gameState.level);
            });
        }
    }
    /* نهاية المرحلة ١ */

/* =========================================================
       المرحلة ٢: منطق اللعب (التدفق، المؤقّت، الأسئلة، الإحصاءات)
       ========================================================= */

    Object.assign(QuizGame.prototype, {
        /* ———————————————— بدء اللعب ———————————————— */
        postInstructionsStart: async function () {
            await this.cleanupSession();
            this.setupInitialGameState();
            this.startGameFlow(0);
        },
        setupInitialGameState: function () {
            this.gameState = {
                name: (this.dom.nameInput?.value || '').trim(),
                avatar: this.gameState.avatar,
                playerId: `PL${Math.random().toString(36).substring(2, 11).toUpperCase()}`,
                deviceId: this.getOrSetDeviceId(),
                sessionId: this.generateSessionId(),
                level: 0, questionIndex: 0,
                wrongAnswers: 0, correctAnswers: 0, skips: 0,
                startTime: new Date(),
                helpersUsed: { fiftyFifty: false, freezeTime: false },
                currentScore: this.config.STARTING_SCORE,
                shuffledQuestions: {},
                attemptNumber: null
            };
        },
        startGameFlow: function (levelIndex = 0) {
            this.gameState.level = levelIndex;
            this.updateScore(this.config.STARTING_SCORE, true);
            this.setupGameUI();
            this.showScreen('game');
            this.playSound('start');
            this.startLevel();
        },

        /* ———————————————— المستويات والأسئلة ———————————————— */
        startLevel: function () {
            const currentLevel = this.config.LEVELS[this.gameState.level];
            this.gameState.helpersUsed = { fiftyFifty: false, freezeTime: false };
            document.body.dataset.level = currentLevel.name;
            this.getEl('#currentLevelBadge')?.textContent = currentLevel.label;

            const levelQuestions = this.getLevelQuestions(currentLevel.name);
            if (levelQuestions.length > 0) {
                this.shuffleArray(levelQuestions);
                this.gameState.shuffledQuestions = levelQuestions;
            } else {
                console.warn('No questions for level:', currentLevel.name);
                this.gameState.shuffledQuestions = [];
            }

            this.updateLevelProgressUI();
            this.gameState.questionIndex = 0;
            this.fetchQuestion();
        },
        fetchQuestion: function () {
            const questions = this.gameState.shuffledQuestions || [];
            if (this.gameState.questionIndex >= questions.length) { this.levelComplete(); return; }
            const q = questions[this.gameState.questionIndex];
            this.displayQuestion(q);
        },
        displayQuestion: function (qData) {
            this.answerSubmitted = false;
            const { text, options, correctText } = this.resolveQuestionFields(qData);

            const safeOptions = Array.isArray(options) ? options.slice() : [];
            if (!text || safeOptions.length === 0) {
                this.showToast('تم تجاوز سؤال غير صالح', 'error');
                this.gameState.skips++;
                this.gameState.questionIndex++;
                return this.fetchQuestion();
            }

            const totalQuestions = (this.gameState.shuffledQuestions || []).length;
            this.getEl('#questionCounter')?.textContent = `السؤال ${this.gameState.questionIndex + 1} من ${totalQuestions}`;
            if (this.dom.questionText) this.dom.questionText.textContent = text;
            if (!this.dom.optionsGrid) return;

            this.dom.optionsGrid.innerHTML = '';

            let displayOptions = [...safeOptions];
            if (displayOptions.length > 0) this.shuffleArray(displayOptions);

            const frag = document.createDocumentFragment();
            displayOptions.forEach(opt => {
                const btn = document.createElement('button');
                btn.className = 'option-btn';
                btn.textContent = opt;
                btn.dataset.correct = (this.normalize(opt) === this.normalize(correctText));
                frag.appendChild(btn);
            });
            this.dom.optionsGrid.appendChild(frag);

            this.updateGameStatsUI();
            this.startTimer();
        },

        /* ———————————————— الإجابة والتقدّم ———————————————— */
        checkAnswer: async function (selectedButton = null) {
            if (this.answerSubmitted) return;
            this.answerSubmitted = true;
            clearInterval(this.timer.interval);
            this.getAllEl('.option-btn').forEach(b => b.classList.add('disabled'));

            let isCorrect = false;
            if (selectedButton?.dataset) isCorrect = selectedButton.dataset.correct === 'true';

            if (isCorrect) {
                selectedButton?.classList.add('correct');
                this.updateScore(this.gameState.currentScore + 100);
                this.gameState.correctAnswers++;
                this.playSound('correct');
                this.showToast('إجابة صحيحة! +100 نقطة', 'success');
            } else {
                selectedButton?.classList.add('wrong');
                const correctButton = this.dom.optionsGrid?.querySelector('[data-correct="true"]');
                correctButton?.classList.add('correct');
                this.gameState.wrongAnswers++;
                this.updateScore(this.gameState.currentScore - 100);
                this.playSound('wrong');
                this.showToast('إجابة خاطئة! -100 نقطة', 'error');
            }

            this.gameState.questionIndex++;
            this.updateGameStatsUI();

            const isGameOver = this.gameState.wrongAnswers >= this.config.MAX_WRONG_ANSWERS;
            const tid = setTimeout(() => { isGameOver ? this.endGame(false) : this.fetchQuestion(); }, 2000);
            this.cleanupQueue.push({ type: 'timeout', id: tid });
        },

        levelComplete: function () {
            const isLast = this.gameState.level >= this.config.LEVELS.length - 1;
            if (isLast) { this.endGame(true); return; }

            this.getEl('#levelCompleteTitle')?.setAttribute('textContent', `🎉 أكملت المستوى ${this.config.LEVELS[this.gameState.level].label}!`);
            // استخدام textContent مباشرة حتى لو لم تدعم setAttribute
            const titleEl = this.getEl('#levelCompleteTitle');
            if (titleEl) titleEl.textContent = `🎉 أكملت المستوى ${this.config.LEVELS[this.gameState.level].label}!`;
            this.getEl('#levelScore')?.setAttribute('textContent', this.formatNumber(this.gameState.currentScore));
            const lvlScore = this.getEl('#levelScore'); if (lvlScore) lvlScore.textContent = this.formatNumber(this.gameState.currentScore);
            const lvlErr = this.getEl('#levelErrors'); if (lvlErr) lvlErr.textContent = this.gameState.wrongAnswers;
            const lvlCor = this.getEl('#levelCorrect'); if (lvlCor) lvlCor.textContent = this.gameState.correctAnswers;

            this.playSound('levelup');
            this.showScreen('levelComplete');
        },
        nextLevel: function () {
            this.gameState.level++;
            if (this.gameState.level >= this.config.LEVELS.length) this.endGame(true);
            else { this.showScreen('game'); this.startLevel(); }
        },

        /* ———————————————— المؤقّت ———————————————— */
        startTimer: function () {
            clearInterval(this.timer.interval);
            this.timer.total = this.config.QUESTION_TIME;
            let timeLeft = this.timer.total;

            const bar = this.getEl('.timer-bar');
            const label = this.getEl('.timer-text');
            if (!bar || !label) return;

            label.textContent = String(timeLeft);
            bar.style.transition = 'width 200ms linear';
            bar.style.width = '100%';

            const update = () => {
                if (this.timer.isFrozen) return;
                timeLeft = Math.max(0, timeLeft - 1);
                label.textContent = String(timeLeft);
                const pct = (timeLeft / this.timer.total) * 100;
                bar.style.width = `${pct}%`;
                if (timeLeft <= 0) {
                    clearInterval(this.timer.interval);
                    this.showToast('انتهى الوقت!', 'error');
                    this.handleTimeout();
                }
            };

            update();
            this.timer.interval = setInterval(update, 1000);
        },
        handleTimeout: function () {
            const anyWrongBtn = this.dom.optionsGrid?.querySelector('.option-btn:not([data-correct="true"])');
            this.checkAnswer(anyWrongBtn || null);
        },

        /* ———————————————— نقاط وإحصاءات ———————————————— */
        updateScore: function (newScore, _isReset = false) {
            this.gameState.currentScore = newScore;
            if (this.dom.scoreDisplay) this.dom.scoreDisplay.textContent = this.formatNumber(this.gameState.currentScore);
            this.updateGameStatsUI();
        },
        updateGameStatsUI: function () {
            const wrongEl = this.getEl('#wrongAnswersCount');
            const skipEl = this.getEl('#skipCount');
            const skipCostEl = this.getEl('#skipCost');

            if (wrongEl) wrongEl.textContent = `${this.gameState.wrongAnswers} / ${this.config.MAX_WRONG_ANSWERS}`;
            if (skipEl)  skipEl.textContent  = String(this.gameState.skips);
            if (skipCostEl) skipCostEl.textContent = '(مجانية)';

            const isImpossible = this.config.LEVELS[this.gameState.level]?.name === 'impossible';
            this.getAllEl('.helper-btn').forEach(btn => {
                const type = btn.dataset.type;
                if (isImpossible) { btn.disabled = true; return; }
                if (type === 'skipQuestion') btn.disabled = false;
                else btn.disabled = this.gameState.helpersUsed[type] === true;
            });
        },
        calculateFinalStats: function (completedAll) {
            const totalTimeSeconds = (new Date() - this.gameState.startTime) / 1000;
            const currentLevelLabel = this.config.LEVELS[Math.min(this.gameState.level, this.config.LEVELS.length - 1)].label;

            const corr = this.gameState.correctAnswers;
            const wrong = this.gameState.wrongAnswers;
            const skips = this.gameState.skips;

            const denom = corr + wrong + (this.config.SKIP_WEIGHT * skips);
            const accuracy = denom > 0 ? parseFloat(((corr / denom) * 100).toFixed(1)) : 0.0;

            const answeredCount = (corr + wrong) || 1;
            const avgTime = parseFloat((totalTimeSeconds / answeredCount).toFixed(1));

            return {
                name: this.gameState.name,
                player_id: this.gameState.playerId,
                device_id: this.gameState.deviceId,
                session_id: this.gameState.sessionId,
                avatar: this.gameState.avatar,
                correct_answers: corr,
                wrong_answers: wrong,
                skips: skips,
                score: this.gameState.currentScore,
                total_time: totalTimeSeconds,
                level: currentLevelLabel,
                accuracy,
                avg_time: avgTime,
                performance_rating: this.getPerformanceRating(accuracy),
                completed_all: completedAll,
                used_fifty_fifty: this.gameState.helpersUsed.fiftyFifty,
                used_freeze_time: this.gameState.helpersUsed.freezeTime
            };
        },

        /* ———————————————— إنهاء اللعب وإعادة المحاولة ———————————————— */
        endGame: async function (completedAllLevels = false) {
            this.clearAllTimers();
            this.hideModal('confirmExit');

            const baseStats = this.calculateFinalStats(completedAllLevels);

            try {
                const perf = await this.ratePerformance(baseStats);
                baseStats.performance_rating = perf.label;
                baseStats.performance_score  = perf.score;
            } catch (_) {
                const acc = Number(baseStats.accuracy || 0);
                baseStats.performance_rating =
                    (acc >= 90) ? 'ممتاز 🏆' :
                    (acc >= 75) ? 'جيد جدًا ⭐' :
                    (acc >= 60) ? 'جيد 👍' :
                    (acc >= 40) ? 'مقبول 👌' : 'يحتاج إلى تحسين 📈';
            }

            this.displayFinalStats(baseStats);
            completedAllLevels ? this.playSound('win') : this.playSound('loss');
            this.showScreen('end');

            this.setCooldown(this.config.COOLDOWN_SECONDS);
            this.startRetryCountdownUI();

            this.saveResultsToSupabase(baseStats).then((res) => {
                if (!res?.error && res?.attemptNumber) {
                    baseStats.attempt_number = res.attemptNumber;
                    this.gameState.attemptNumber = res.attemptNumber;
                    const el = this.getEl('#finalAttemptNumber'); if (el) el.textContent = String(res.attemptNumber);
                    this.playSound('coin');
                    this.showToast('تم حفظ نتيجتك!', 'success');
                } else if (res?.error) {
                    this.showToast('تعذّر حفظ النتيجة — سنحاول لاحقًا.', 'error');
                }
            }).catch(()=>{});

            setTimeout(() => { this.cleanupSession({ keepEndScreen: true }); }, 800);
        },
        playAgainGuarded: async function (_btn) {
            const remain = this.getCooldownRemaining();
            if (remain > 0) {
                this.updateRetryCountdownUI(remain);
                this.showToast(`⏳ يمكنك المحاولة بعد ${remain} ثانية.`, 'info');
                return;
            }
            await this.cleanupSession();
            this.currentSessionId = this.generateSessionId();

            if (this._endCountdownInterval) {
                clearInterval(this._endCountdownInterval);
                this._endCountdownInterval = null;
            }
            window.location.reload();
        },
        startRetryCountdownUI: function () {
            const btn   = this.getEl('#playAgainBtn') || this.getEl('#endScreen [data-action="playAgain"]');
            const label = this.dom.retryCountdown || this.getEl('#retryCountdown');
            if (!btn) return;

            const originalText = btn.dataset.originalText || btn.textContent || 'لعب مرة أخرى';
            btn.dataset.originalText = originalText;

            const applyState = () => {
                const r = this.getCooldownRemaining();
                if (r > 0) {
                    btn.disabled = true;
                    btn.setAttribute('aria-busy', 'true');
                    btn.textContent = `🔒 يمكنك اللعب مجددًا بعد ${r} ثانية`;
                    if (label) { label.textContent = String(r); label.style.display = ''; }
                } else {
                    btn.disabled = false;
                    btn.removeAttribute('aria-busy');
                    btn.textContent = originalText;
                    if (label) { label.textContent = '0'; label.style.display = ''; }
                    if (this._endCountdownInterval) {
                        clearInterval(this._endCountdownInterval);
                        this._endCountdownInterval = null;
                    }
                }
            };

            applyState();
            const intervalId = setInterval(applyState, 1000);
            this._endCountdownInterval = intervalId;
            this.cleanupQueue.push({ type: 'interval', id: intervalId, keep: true });
        },
        updateRetryCountdownUI: function (remain) {
            const btn = this.getEl('#playAgainBtn') || this.getEl('#endScreen [data-action="playAgain"]');
            const label = this.dom.retryCountdown || this.getEl('#retryCountdown');
            if (!btn) return;

            const originalText = btn.dataset.originalText || btn.textContent || 'لعب مرة أخرى';
            btn.dataset.originalText = originalText;

            if (remain > 0) {
                btn.disabled = true;
                btn.setAttribute('aria-busy','true');
                btn.textContent = `🔒 يمكنك اللعب مجددًا بعد ${remain} ثانية`;
                if (label) { label.textContent = String(remain); label.style.display = ''; }
            } else {
                btn.disabled = false;
                btn.removeAttribute('aria-busy');
                btn.textContent = originalText;
                if (label) { label.textContent = '0'; label.style.display = ''; }
            }
        },

        // قفل زر البداية بنفس منطق “لعب مرة أخرى”
        startFromHomeGuarded: async function (_btn) {
            const remain = this.getCooldownRemaining();
            if (remain > 0) {
                this.updateStartCooldownUI(remain);
                this.showToast(`⏳ يمكنك البدء بعد ${remain} ثانية.`, 'info');
                return;
            }
            this.showScreen('avatar');
        },
        startStartCooldownUI: function () {
            const btn = this.getEl('#startBtn');
            if (!btn) return;

            const originalText = btn.dataset.originalText || btn.textContent || 'ابدأ اللعب';
            btn.dataset.originalText = originalText;

            let intervalId = null;

            const applyState = () => {
                const r = this.getCooldownRemaining();
                if (r > 0) {
                    btn.disabled = true;
                    btn.setAttribute('aria-busy', 'true');
                    btn.textContent = `🔒 يمكنك البدء بعد ${r} ثانية`;
                } else {
                    btn.disabled = false;
                    btn.removeAttribute('aria-busy');
                    btn.textContent = originalText;
                    if (intervalId) clearInterval(intervalId);
                }
            };

            applyState();
            intervalId = setInterval(applyState, 1000);
            this.cleanupQueue.push({ type: 'interval', id: intervalId });
        },
        updateStartCooldownUI: function (remain) {
            const btn = this.getEl('#startBtn');
            if (!btn) return;
            const originalText = btn.dataset.originalText || btn.textContent || 'ابدأ اللعب';
            btn.dataset.originalText = originalText;

            if (remain > 0) {
                btn.disabled = true;
                btn.setAttribute('aria-busy', 'true');
                btn.textContent = `🔒 يمكنك البدء بعد ${remain} ثانية`;
            } else {
                btn.disabled = false;
                btn.removeAttribute('aria-busy');
                btn.textContent = originalText;
            }
        },

        /* ———————————————— تنظيف شامل ———————————————— */
        async cleanupSession(opts = {}) {
            const { keepEndScreen = false } = opts;
            this.clearAllTimers();
            this.abortPendingRequests();
            this.removeTemporaryListeners();
            this.clearSessionStorage();
            this.resetGameState();
            this.resetUI(keepEndScreen);
            await this.processCleanupQueue();
        },
        clearAllTimers: function () {
            if (this.timer.interval) { clearInterval(this.timer.interval); this.timer.interval = null; }

            this.cleanupQueue.forEach(i => {
                if (i.type === 'timeout') clearTimeout(i.id);
                else if (i.type === 'interval') {
                    if (i.keep === true) return;
                    clearInterval(i.id);
                }
            });
            this.cleanupQueue = this.cleanupQueue.filter(i => i.keep === true);
        },
        abortPendingRequests() {
            this.pendingRequests.forEach(controller => {
                if (!controller) return;
                if (controller.__skipAbortOnCleanup) return;
                if (!controller.signal.aborted) controller.abort();
            });
            this.pendingRequests.clear();
        },
        removeTemporaryListeners: function () {
            this.cleanupQueue.forEach(i => { if (i.type === 'listener' && i.element && i.handler) i.element.removeEventListener(i.event, i.handler); });
        },
        clearSessionStorage: function () {
            const keysToRemove = [];
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key && key.startsWith('quiz_')) keysToRemove.push(key);
            }
            keysToRemove.forEach(k => sessionStorage.removeItem(k));
            ['currentLevel','currentIndex','shuffledQuestions','activeLifelines','tempScore','tempTime','attemptDraft']
                .forEach(k => localStorage.removeItem(k));
        },
        resetGameState: function () {
            this.gameState = {
                name: this.gameState.name || '',
                avatar: this.gameState.avatar || '',
                playerId: this.gameState.playerId || '',
                deviceId: this.getOrSetDeviceId(),
                sessionId: this.generateSessionId()
            };
            this.timer = { interval: null, isFrozen: false, total: 0 };
            this.answerSubmitted = false;
        },
        resetUI: function (keepEndScreen = false) {
            this.getAllEl('.level-indicator').forEach(ind => ind.classList.remove('active','completed'));
            const sc = this.getEl('#currentScore'); if (sc) sc.textContent = '100';
            const wa = this.getEl('#wrongAnswersCount'); if (wa) wa.textContent = '0 / 3';
            const sk = this.getEl('#skipCount'); if (sk) sk.textContent = '0';
            Object.values(this.dom.screens).forEach(s => s?.classList?.remove('active'));
            const target = keepEndScreen ? this.dom.screens.end : this.dom.screens.start;
            target?.classList?.add('active');
        },
        async processCleanupQueue() {
            const ps = this.cleanupQueue.filter(i => i.promise).map(i => i.promise.catch(()=>{}));
            await Promise.allSettled(ps);
            this.cleanupQueue = [];
        },

        /* ———————————————— إدخال الاسم ———————————————— */
        handleNameConfirmation: function () { if (!this.dom.confirmNameBtn?.disabled) this.showScreen('instructions'); },
        validateNameInput: function () {
            const name = (this.dom.nameInput?.value || '').trim();
            const isValid = name.length >= 3 && name.length <= 15;
            if (this.dom.nameError) this.dom.nameError.textContent = isValid ? '' : 'يجب أن يتراوح طول الاسم بين ٣ - ١٥ حرفًا';
            this.dom.nameError?.classList.toggle('show', !isValid);
            if (this.dom.confirmNameBtn) this.dom.confirmNameBtn.disabled = !isValid;
        },

        postInstructionsStartGuarded: async function (_targetBtn) {
            const remain = this.getCooldownRemaining();
            if (remain > 0) {
                this.showToast(`⏳ انتظر ${remain} ثانية قبل المحاولة التالية.`, 'info');
                this.updateRetryCountdownUI(remain);
                return;
            }
            await this.cleanupSession();
            this.setupInitialGameState();
            this.startGameFlow(0);
        },

        /* ———————————————— المساعدات ———————————————— */
        useHelper: function (btn) {
            const type = btn.dataset.type;
            const isSkip = type === 'skipQuestion';
            const isImpossible = this.config.LEVELS[this.gameState.level]?.name === 'impossible';
            if (isImpossible) { this.showToast('المساعدات غير متاحة في المستوى المستحيل.', 'error'); return; }

            const cost = isSkip ? 0 : this.config.HELPER_COSTS[type];
            if (!isSkip && this.gameState.helpersUsed[type]) { this.showToast('هذه المساعدة استُخدمت بالفعل في هذا المستوى.', 'error'); return; }
            if (cost > 0) {
                if (this.gameState.currentScore < cost) { this.showToast('نقاطك غير كافية!', 'error'); return; }
                this.updateScore(this.gameState.currentScore - cost);
                this.showToast(`تم استخدام المساعدة! -${cost} نقطة`, 'info');
            } else if (isSkip) { this.showToast('تم تخطي السؤال.', 'info'); }

            if (isSkip) {
                clearInterval(this.timer.interval);
                this.gameState.skips++;
                this.gameState.questionIndex++;
                this.updateGameStatsUI();
                this.fetchQuestion();
                return;
            }

            this.gameState.helpersUsed[type] = true;
            this.updateGameStatsUI();

            if (type === 'fiftyFifty') {
                const wrong = this.getAllEl('.option-btn:not([data-correct="true"])');
                this.shuffleArray(Array.from(wrong)).slice(0, 2).forEach(b => b.classList.add('hidden'));
            } else if (type === 'freezeTime') {
                this.timer.isFrozen = true;
                this.getEl('.timer-bar')?.classList.add('frozen');
                setTimeout(() => {
                    this.timer.isFrozen = false;
                    this.getEl('.timer-bar')?.classList.remove('frozen');
                }, 10000);
            }
        },

        /* ———————————————— تهيئة واجهة اللعب والنتيجة ———————————————— */
        setupGameUI: function () {
            const av = this.getEl('#playerAvatar'); if (av) av.src = this.gameState.avatar || '';
            const nm = this.getEl('#playerName'); if (nm) nm.textContent = this.gameState.name || '';
            const id = this.getEl('#playerId'); if (id) id.textContent = this.gameState.playerId || '';
        },
        displayFinalStats: function (stats) {
            this.getEl('#finalName')?.setAttribute('textContent', stats.name);
            const f1 = this.getEl('#finalName'); if (f1) f1.textContent = stats.name;

            this.getEl('#finalId')?.setAttribute('textContent', stats.player_id);
            const f2 = this.getEl('#finalId'); if (f2) f2.textContent = stats.player_id;

            this.getEl('#finalAttemptNumber')?.setAttribute('textContent', stats.attempt_number);
            const f3 = this.getEl('#finalAttemptNumber'); if (f3) f3.textContent = stats.attempt_number;

            const setTxt = (sel, val) => { const el = this.getEl(sel); if (el) el.textContent = String(val); };

            setTxt('#finalCorrect', stats.correct_answers);
            setTxt('#finalWrong', stats.wrong_answers);
            setTxt('#finalSkips', stats.skips);
            setTxt('#finalScore', this.formatNumber(stats.score));
            setTxt('#totalTime', this.formatTime(stats.total_time));
            setTxt('#finalLevel', stats.level);
            setTxt('#finalAccuracy', `${stats.accuracy}%`);
            setTxt('#finalAvgTime', `${this.formatTime(stats.avg_time)}`);
            setTxt('#performanceText', stats.performance_rating);
        },

        /* ———————————————— أدوات حسابية/تنسيقية ———————————————— */
        getPerformanceRating: function (accuracy) {
            if (accuracy >= 90) return 'ممتاز 🏆';
            if (accuracy >= 75) return 'جيد جدًا ⭐';
            if (accuracy >= 60) return 'جيد 👍';
            if (accuracy >= 40) return 'مقبول 👌';
            return 'يحتاج تحسين 📈';
        },
        formatTime: function (totalSeconds) {
            const total = Math.floor(Number(totalSeconds) || 0);
            const minutes = Math.floor(total / 60);
            const seconds = total % 60;
            return `${minutes}:${seconds.toString().padStart(2, '0')}`;
        },
        formatNumber: function (num) { return new Intl.NumberFormat('ar-EG').format(Number(num) || 0); },
        normalize: function (s) { return String(s || '').trim().toLowerCase(); },
        resolveQuestionFields: function (q) {
            const text = q.q || q.question || q.text || '';
            const options = Array.isArray(q.options) ? q.options : (Array.isArray(q.choices) ? q.choices : []);
            let correctText = '';
            if (typeof q.correct === 'number' && options[q.correct] !== undefined) correctText = options[q.correct];
            else if (typeof q.answer === 'string') correctText = q.answer;
            else if (typeof q.correctAnswer === 'string') correctText = q.correctAnswer;
            else if (typeof q.correct_option === 'string') correctText = q.correct_option;
            else if (typeof q.correctIndex === 'number' && options[q.correctIndex] !== undefined) correctText = options[q.correctIndex];
            return { text, options, correctText };
        },
        getLevelQuestions: function (levelName) {
            if (Array.isArray(this.questions)) {
                const arr = this.questions.filter(q =>
                    (this.normalize(q.level) === this.normalize(levelName)) ||
                    (this.normalize(q.difficulty) === this.normalize(levelName))
                );
                return arr.length ? arr : [...this.questions];
            }
            const direct = this.questions[levelName] ||
                           this.questions[levelName + 'Questions'] ||
                           this.questions[levelName + '_questions'] ||
                           this.questions[levelName + '_list'];
            if (Array.isArray(direct)) return [...direct];
            if (Array.isArray(this.questions.questions)) return [...this.questions.questions];
            const merged = Object.values(this.questions).filter(Array.isArray).flat();
            return merged.length ? merged : [];
        },
        shuffleArray: function (arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; },
        normalizeTo100: function (value, min, max) { const v = Math.max(min, Math.min(max, Number(value) || 0)); return Math.round(((max - v) / (max - min)) * 100); },
        stdDev: function (arr) {
            if (!arr || arr.length < 2) return 0;
            const mean = arr.reduce((a,b)=>a+Number(b||0),0)/arr.length;
            const variance = arr.reduce((s,v)=> s + Math.pow(Number(v||0)-mean,2),0)/(arr.length-1);
            return Math.sqrt(variance);
        },
        mapPerformanceLabel: function (score, { completed_all = false, level = '' } = {}) {
            if (completed_all && (level === 'مستحيل' || level === 'impossible')) score = Math.max(score, 80);
            if (score >= 97) return 'احترافي 🧠';
            if (score >= 92) return 'مذهل 🌟';
            if (score >= 85) return 'ممتاز 🏆';
            if (score >= 75) return 'جيد جدًا ⭐';
            if (score >= 62) return 'جيد 👍';
            if (score >= 50) return 'مقبول 👌';
            if (score >= 35) return 'يحتاج إلى تحسين 📈';
            return 'ضعيف 🧩';
        },
        ratePerformance: async function (current) {
            let history = [];
            try {
                const { data, error } = await this.supabase
                    .from('log')
                    .select('accuracy,avg_time,score,correct_answers,wrong_answers,skips,completed_all,level,created_at')
                    .eq('device_id', current.device_id)
                    .order('created_at', { ascending: false })
                    .limit(20);
                if (!error && Array.isArray(data)) history = data;
            } catch (_) {}

            const histAcc = history.map(h => Number(h.accuracy || 0)).filter(n => n >= 0);
            const histAvg = history.map(h => Number(h.avg_time || 0)).filter(n => n >= 0);
            const histDone = history.filter(h => h.completed_all === true).length;
            const histCount = history.length;

            const accuracy = Number(current.accuracy || 0);
            const avgTime = Number(current.avg_time || 0);
            const totalSec = Number(current.total_time || 0);
            const corr = Number(current.correct_answers || 0);
            const wrong = Number(current.wrong_answers || 0);
            const skips = Number(current.skips || 0);
            const lvlName = (current.level || '').toString();
            const completedAll = !!current.completed_all;

            const accScore = Math.max(0, Math.min(100, accuracy));
            const speedScore = this.normalizeTo100(avgTime, 3, 20);

            let levelBonus = 0;
            if (['medium','متوسط'].includes(lvlName)) levelBonus += 10;
            else if (['hard','صعب'].includes(lvlName)) levelBonus += 25;
            else if (['impossible','مستحيل'].includes(lvlName)) levelBonus += 40;
            if (completedAll) levelBonus += 15;

            const cpm = totalSec > 0 ? corr / (totalSec / 60) : 0;
            const cpmBonus = Math.min(20, Math.round(cpm * 4));
            const penalty = (wrong * 4) + (skips * 2);

            let historyBonus = 0;
            if (histCount > 0) {
                const avgAccHist = histAcc.reduce((a,b)=>a+b,0)/(histAcc.length||1);
                const avgTimeHist = histAvg.reduce((a,b)=>a+b,0)/(histAvg.length||1);

                const accDelta = accuracy - avgAccHist;
                if (accDelta >= 10) historyBonus += 8;
                else if (accDelta >= 5) historyBonus += 4;
                else if (accDelta <= -10) historyBonus -= 6;

                const sdAcc = this.stdDev(histAcc);
                if (sdAcc <= 8 && avgAccHist >= 70) historyBonus += 5;

                const doneRate = (histDone / histCount) * 100;
                if (doneRate >= 50) historyBonus += 5;
                else if (doneRate >= 25) historyBonus += 2;

                if (avgTimeHist && avgTime < avgTimeHist - 2) historyBonus += 3;
            }

            let score = (0.45 * accScore) + (0.25 * speedScore) + levelBonus + cpmBonus + historyBonus - penalty;
            score = Math.max(0, Math.min(100, Math.round(score)));
            const label = this.mapPerformanceLabel(score, { completed_all: completedAll, level: lvlName });
            return { score, label, details: { accScore, speedScore, levelBonus, cpmBonus, historyBonus, penalty } };
        }
    });
    /* نهاية المرحلة ٢ */

/* =========================================================
   المرحلة ٣: التكامل والخدمات (Supabase، لوحة الصدارة، البلاغات، الصور)
   ========================================================= */

Object.assign(QuizGame.prototype, {
  /* ———————————————— تحميل الأسئلة ———————————————— */
  async loadQuestions() {
    try {
      const res = await fetch(this.config.QUESTIONS_URL, {
        cache: 'no-cache',
        headers: { 'Content-Type': 'application/json' },
        mode: 'cors'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (typeof data === 'object' && data !== null) {
        this.questions = data;
        return true;
      }
      throw new Error('Invalid questions data');
    } catch (err) {
      console.error('Failed to load questions:', err);
      this.showToast('خطأ في تحميل الأسئلة', 'error');
      return false;
    }
  },

  /* ———————————————— حفظ النتيجة ———————————————— */
  async saveResultsToSupabase(resultsData) {
    const payload = {
      device_id: resultsData?.device_id || this.getOrSetDeviceId(),
      session_id:
        resultsData?.session_id ||
        this.gameState?.sessionId ||
        this.currentSessionId ||
        this.generateSessionId(),
      ...resultsData
    };

    const idemKey = `save:${payload.session_id}`;
    if (this.idempotency.has(idemKey))
      return { attemptNumber: null, error: null };
    this.idempotency.add(idemKey);

    const ctrl = new AbortController();
    ctrl.__skipAbortOnCleanup = true;
    this.pendingRequests.add(ctrl);

    const timeoutId = setTimeout(() => {
      try {
        ctrl.abort('timeout');
      } catch (_) {}
    }, this.config.REQ_TIMEOUT_MS);
    this.cleanupQueue.push({ type: 'timeout', id: timeoutId });

    try {
      // ✅ استخدم أداة الاستدعاء الموحّدة مع الترويسات الصحيحة (Authorization + apikey + x-app-key)
      const res = await this.edgeFetch('saveResult', payload, {
        method: 'POST',
        signal: ctrl.signal
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${txt ? `: ${txt}` : ''}`);
      }
      const json = await res.json().catch(() => ({}));
      this.showToast('تم حفظ نتيجتك بنجاح!', 'success');
      this.playSound('coin');
      return {
        attemptNumber: json.attempt_number || json.attemptNumber || null,
        error: null
      };
    } catch (error) {
      this.showToast('فشل إرسال النتائج إلى السيرفر', 'error');
      if (typeof this.queueFailedSubmission === 'function') {
        try {
          this.queueFailedSubmission(payload);
        } catch (_) {}
      }
      return { attemptNumber: null, error: String(error) };
    } finally {
      clearTimeout(timeoutId);
      this.pendingRequests.delete(ctrl);
    }
  },

  queueFailedSubmission(data) {
    try {
      const list = JSON.parse(localStorage.getItem('failedSubmissions') || '[]');
      list.push({
        data,
        timestamp: new Date().toISOString(),
        type: 'gameResult'
      });
      localStorage.setItem(
        'failedSubmissions',
        JSON.stringify(list.slice(-10))
      );
    } catch (e) {
      console.error('Failed to queue submission:', e);
    }
  },

  async retryFailedSubmissions() {
    try {
      const list = JSON.parse(localStorage.getItem('failedSubmissions') || '[]');
      if (!list.length) return;
      const okList = [];
      for (const sub of list) {
        try {
          if (sub.type === 'gameResult') {
            const res = await this.saveResultsToSupabase(sub.data);
            if (!res.error) okList.push(sub);
          }
        } catch (e) {
          console.error('Retry failed:', e);
        }
      }
      if (okList.length) {
        const remaining = list.filter((s) => !okList.includes(s));
        localStorage.setItem('failedSubmissions', JSON.stringify(remaining));
      }
    } catch (e) {
      console.error('Error retrying submissions:', e);
    }
  },

  /* ———————————————— لوحة الصدارة ———————————————— */
  async displayLeaderboard() {
    this.showScreen('leaderboard');
    this.dom.leaderboardContent.innerHTML = '<div class="spinner"></div>';

    if (!this.lbFirstOpenDone) {
      if (this.dom.lbMode) this.dom.lbMode.value = 'all';
      this.lbFirstOpenDone = true;
    }
    const mode = this.dom.lbMode?.value || 'all';
    if (this.dom.lbAttempt) this.dom.lbAttempt.disabled = mode !== 'attempt';

    try {
      let rows = [];

      if (mode === 'attempt') {
        await this.updateAttemptsFilter();
        const attemptN = Number(this.dom.lbAttempt?.value || 1);
        const res = await this.edgeFetch(
          'leaderboard',
          { mode: 'attempt', attempt: attemptN },
          { method: 'POST' }
        );
        if (!res.ok) throw new Error('leaderboard attempt failed');
        rows = await res.json();
      } else {
        const res = await this.edgeFetch('leaderboard', { mode }, { method: 'POST' });
        if (!res.ok) throw new Error('leaderboard failed');
        rows = await res.json();

        // «أفضل نتيجة لكل جهاز» عند اختيار best
        if (mode === 'best') {
          const seen = new Map();
          for (const r of rows) if (!seen.has(r.device_id)) seen.set(r.device_id, r);
          rows = [...seen.values()];
        }
      }

      this.renderLeaderboard((rows || []).slice(0, 50));
    } catch (e) {
      console.error('Error loading leaderboard:', e);
      this.dom.leaderboardContent.innerHTML =
        '<p>حدث خطأ في تحميل لوحة الصدارة.</p>';
    }
  },

  async updateAttemptsFilter() {
    try {
      const res = await this.edgeFetch('leaderboard', { mode: 'maxAttempt' }, { method: 'POST' });
      if (!res.ok) throw new Error('maxAttempt failed');
      const { maxAttempt = 1 } = await res.json();
      if (this.dom.lbAttempt) {
        const prev = this.dom.lbAttempt.value || '';
        this.dom.lbAttempt.innerHTML = '';
        for (let i = 1; i <= maxAttempt; i++) {
          const opt = document.createElement('option');
          opt.value = String(i);
          opt.textContent = `المحاولة ${i}`;
          this.dom.lbAttempt.appendChild(opt);
        }
        if (prev && Number(prev) >= 1 && Number(prev) <= maxAttempt)
          this.dom.lbAttempt.value = String(prev);
        else this.dom.lbAttempt.value = String(maxAttempt);
      }
    } catch (e) {
      console.error('Error updating attempts filter:', e);
    }
  },

  renderLeaderboard(players) {
    if (!players.length) {
      this.dom.leaderboardContent.innerHTML =
        '<p>لوحة الصدارة فارغة حاليًا!</p>';
      return;
    }
    const list = document.createElement('ul');
    list.className = 'leaderboard-list';
    const medals = ['🥇', '🥈', '🥉'];
    let rank = 1;

    players.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'leaderboard-item';
      let rankDisplay;
      if (p.is_impossible_finisher) {
        li.classList.add('impossible-finisher');
        rankDisplay = '🎖️';
      } else {
        if (rank <= 3) {
          li.classList.add(`rank-${rank}`);
          rankDisplay = medals[rank - 1];
        } else rankDisplay = rank;
        rank++;
      }
      li.innerHTML = `
          <span class="leaderboard-rank">${rankDisplay}</span>
          <img src="${p.avatar || ''}" alt="صورة ${p.name || ''}"
               class="leaderboard-avatar" loading="lazy"
               style="visibility:${p.avatar ? 'visible':'hidden'}">
          <div class="leaderboard-details">
            <span class="leaderboard-name">${p.name || 'غير معروف'}</span>
            <span class="leaderboard-score">${this.formatNumber(p.score)}</span>
          </div>`;
      li.addEventListener('click', () => this.showPlayerDetails(p));
      list.appendChild(li);
    });

    this.dom.leaderboardContent.innerHTML = '';
    this.dom.leaderboardContent.appendChild(list);
  },

  subscribeToLeaderboardChanges() {
    if (this.leaderboardSubscription) this.leaderboardSubscription.unsubscribe();
    this.leaderboardSubscription = this.supabase
      .channel('public:leaderboard')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leaderboard' },
        () => this.displayLeaderboard()
      )
      .subscribe();
  },

  /* ———————————————— تفاصيل اللاعب ———————————————— */
  showPlayerDetails(player) {
    this.getEl('#detailsName').textContent = player.name || 'غير معروف';
    this.getEl('#detailsPlayerId').textContent = player.player_id || 'N/A';
    const avatarEl = this.getEl('#detailsAvatar');
    avatarEl.src = player.avatar || '';
    avatarEl.style.visibility = player.avatar ? 'visible' : 'hidden';

    const score = Number(player.score || 0);
    const level = player.level || 'N/A';
    const correct = Number(player.correct_answers || 0);
    const wrong = Number(player.wrong_answers || 0);
    const timeAll = this.formatTime(player.total_time || 0);
    const avg = this.formatTime(player.avg_time || 0);
    const accNum = Math.max(
      0,
      Math.min(100, Math.round(Number(player.accuracy || 0)))
    );
    const skips = Number(player.skips || 0);
    const att = Number(player.attempt_number || 0);
    const perf = player.performance_rating || 'جيد';

    const card = (title, value, extra = '') => `
      <div class="stat-card" style="${extra}">
        <div class="label">${title}</div>
        <div class="value">${value}</div>
      </div>`;
    const twoRows = (k1, v1, k2, v2, extra = '') => `
      <div class="stat-card" style="display:grid;gap:.38rem;${extra}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.6rem"><span class="label">${k1}</span><span class="value" style="font-size:1.06rem">${v1}</span></div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.6rem"><span class="label">${k2}</span><span class="value" style="font-size:1.06rem">${v2}</span></div>
      </div>`;
    const pos = (v) =>
      `<span style="color:var(--success-color)">${this.formatNumber(v)}</span>`;
    const neg = (v) =>
      `<span style="color:var(--error-color)">${this.formatNumber(v)}</span>`;

    const html = `
      <div class="stats-grid">
        ${card('👑 المستوى', level)}
        ${card('⭐ النقاط', `<span class="value score">${this.formatNumber(score)}</span>`)}
        ${twoRows('✅ الصحيحة', pos(correct), '❌ الخاطئة', neg(wrong))}
        ${twoRows('⏱️ الوقت', timeAll, '⏳ المتوسط', `${avg}`)}
        ${card('🔢 المحاولة', this.formatNumber(att))}
        ${card('⏭️ التخطّي', this.formatNumber(skips))}
        ${card('📊 الأداء', perf)}
        <div class="stat-card accuracy">
          <div class="label" style="margin-bottom:.3rem">🎯 الدقّة</div>
          <div style="display:grid;place-items:center">
            <div class="circle-progress" style="--val:${accNum};--bar:${this.getAccuracyBarColor(accNum)};"><span>${accNum}%</span></div>
          </div>
        </div>
      </div>`;
    this.getEl('#playerDetailsContent').innerHTML = html;
    this.showModal('playerDetails');
  },

  getAccuracyBarColor(pct) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    const hue = Math.round((p / 100) * 120);
    return `hsl(${hue} 70% 45%)`;
  },

  /* ———————————————— البلاغات ———————————————— */
  handleReportSubmitGuarded(event) {
    event.preventDefault();
    const form = event.target;
    if (form.dataset.busy === '1') return;
    form.dataset.busy = '1';
    setTimeout(() => {
      form.dataset.busy = '0';
    }, this.config.CLICK_DEBOUNCE_MS + 300);

    const formData = new FormData(form);
    const problemLocation = formData.get('problemLocation');

    const reportData = {
      type: formData.get('problemType'),
      description: formData.get('problemDescription'),
      name: this.gameState.name || 'لم يبدأ اللعب',
      player_id: this.gameState.playerId || 'N/A',
      question_text: this.dom.questionText?.textContent || 'لا يوجد'
    };

    if (!reportData.description || String(reportData.description).trim().length === 0) {
      this.showToast('رجاءً اكتب وصفًا للمشكلة قبل الإرسال.', 'error');
      return;
    }

    let meta = null;
    if (this.dom.includeAutoDiagnostics?.checked) {
      meta = this.getAutoDiagnostics();
      meta.locationHint = problemLocation;
    }
    const ctx = this.buildQuestionRef();

    const idemKey = `report:${this.simpleHash(
      JSON.stringify({ reportData, ctx })
    )}`;
    if (this.idempotency.has(idemKey)) {
      this.showToast('تم إرسال هذا البلاغ بالفعل.', 'info');
      this.hideModal('advancedReport');
      return;
    }
    this.idempotency.add(idemKey);

    this.showToast('يتم إرسال البلاغ…', 'info');
    this.hideModal('advancedReport');

    (async () => {
      try {
        // ——— اجمع الصورة كـ base64 (إن وُجدت) ———
        let image_base64 = null;
        const file = this.dom.problemScreenshot?.files?.[0];
        if (file) {
          if (file.size > 3 * 1024 * 1024) {
            this.showToast('حجم الصورة كبير (أكثر من 3MB).', 'error');
            throw new Error('image too large');
          }
          image_base64 = await new Promise((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result)); // data:image/...;base64,....
            r.readAsDataURL(file);
          });
        }

        const payload = {
          ...reportData,
          image_base64, // الدالة سترفع وتعيد URL
          meta: {
            ...(meta || {}),
            context: ctx,
            device_id: this.gameState?.deviceId || this.getOrSetDeviceId(),
            session_id: this.gameState?.sessionId || this.currentSessionId
          }
        };

        // ✅ أرسل عبر أداة edgeFetch كي يُضاف Authorization تلقائيًا
        const res = await this.edgeFetch('report', payload, { method: 'POST' });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          console.error('report edge error:', res.status, txt);
          throw new Error('report edge call failed');
        }

        // ——— نجاح ———
        try {
          form.reset();
          if (this.dom.reportImagePreview) {
            this.dom.reportImagePreview.style.display = 'none';
            this.dom.reportImagePreview.querySelector('img').src = '';
          }
          if (this.dom.problemScreenshot) this.dom.problemScreenshot.value = '';
        } catch (_) {}

        setTimeout(
          () => this.showToast('تم إرسال بلاغك. شكرًا لك!', 'success'),
          400
        );
      } catch (err) {
        console.error('Report error:', err);
        this.showToast('تعذّر إرسال البلاغ الآن.', 'error');
      }
    })();
  },

  // (إبقاء الدالة القديمة للرجوع، لكن نعيد توجيهها للأداة الموحدة)
  async sendReportViaEdge(payload) {
    try {
      const res = await this.edgeFetch('report', payload, { method: 'POST' });
      return res.ok;
    } catch (e) {
      console.error('report edge fetch failed:', e);
      return false;
    }
  },

  /* ———————————————— صور رمزية (رفع/قص) ———————————————— */
  populateAvatarGrid() {
    const grid = this.getEl('.avatar-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const uploadBtnHTML = `
      <div class="avatar-upload-btn" title="رفع صورة">
        <span aria-hidden="true">+</span>
        <label for="avatarUploadInput" class="sr-only">رفع صورة</label>
        <input type="file" id="avatarUploadInput" accept="image/*" style="display:none;">
      </div>`;
    grid.insertAdjacentHTML('beforeend', uploadBtnHTML);
    this.getEl('#avatarUploadInput').addEventListener('change', (e) =>
      this.handleAvatarUpload(e)
    );
    this.getEl('.avatar-upload-btn').addEventListener('click', () =>
      this.getEl('#avatarUploadInput').click()
    );

    const avatarUrls = [
      'https://em-content.zobj.net/thumbs/120/apple/354/woman_1f469.png',
      'https://em-content.zobj.net/thumbs/120/apple/354/man_1f468.png',
      'https://em-content.zobj.net/thumbs/120/apple/354/person-beard_1f9d4.png',
      'https://em-content.zobj.net/thumbs/120/apple/354/old-man_1f474.png',
      'https://em-content.zobj.net/thumbs/120/apple/354/student_1f9d1-200d-1f393.png',
      'https://em-content.zobj.net/thumbs/120/apple/354/teacher_1f9d1-200d-1f3eb.png',
      'https://em-content.zobj.net/thumbs/120/apple/354/scientist_1f9d1-200d-1f52c.png',
      'https://em-content.zobj.net/thumbs/120/apple/354/artist_1f9d1-200d-1f3a8.png'
    ];
    avatarUrls.forEach((url, i) => {
      const img = document.createElement('img');
      img.src = url;
      img.alt = `صورة رمزية ${i + 1}`;
      img.className = 'avatar-option';
      img.loading = 'lazy';
      grid.appendChild(img);
    });
  },

  selectAvatar(element) {
    this.getAllEl('.avatar-option.selected, .avatar-upload-btn.selected').forEach(
      (el) => el.classList.remove('selected')
    );
    element.classList.add('selected');
    this.gameState.avatar = element.src;
    if (this.dom.confirmAvatarBtn) this.dom.confirmAvatarBtn.disabled = false;
  },

  handleAvatarUpload(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.dom.imageToCrop.src = e.target.result;
        this.showModal('avatarEditor');
        setTimeout(() => {
          if (this.cropper) this.cropper.destroy();
          this.cropper = new Cropper(this.dom.imageToCrop, {
            aspectRatio: 1,
            viewMode: 1,
            autoCropArea: 1
          });
        }, 300);
      };
      reader.readAsDataURL(file);
    }
  },

  saveCroppedAvatar() {
    if (!this.cropper) return;
    const croppedUrl = this.cropper
      .getCroppedCanvas({ width: 256, height: 256 })
      .toDataURL('image/png');
    let customAvatar = this.getEl('#custom-avatar');
    if (!customAvatar) {
      customAvatar = document.createElement('img');
      customAvatar.id = 'custom-avatar';
      customAvatar.className = 'avatar-option';
      this.getEl('.avatar-upload-btn').after(customAvatar);
    }
    customAvatar.src = croppedUrl;
    this.selectAvatar(customAvatar);
    this.hideModal('avatarEditor');
    this.cleanupAvatarEditor();
  },

  cleanupAvatarEditor() {
    try {
      if (this.cropper) {
        this.cropper.destroy();
        this.cropper = null;
      }
    } catch (_) {}
    if (this.dom?.imageToCrop) this.dom.imageToCrop.src = '';
    const input = this.getEl('#avatarUploadInput');
    if (input) input.value = '';
  },

  /* ———————————————— مشاركة ———————————————— */
  getShareTextForX() {
    const name = this.getEl('#finalName').textContent || '';
    const attempt = this.getEl('#finalAttemptNumber').textContent || '';
    const correct = this.getEl('#finalCorrect').textContent || '0';
    const skips = this.getEl('#finalSkips').textContent || '0';
    const level = this.getEl('#finalLevel').textContent || '';
    const acc = this.getEl('#finalAccuracy').textContent || '0%';
    const avg = this.getEl('#finalAvgTime').textContent || '0:00 / سؤال';
    const perf = this.getEl('#performanceText').textContent || '';
    return [
      '🏆 النتائج النهائية 🏆',
      '',
      `الاسم: ${name}`,
      `رقم المحاولة: ${attempt}`,
      `الإجابات الصحيحة: ${correct}`,
      `مرات التخطي: ${skips}`,
      `المستوى الذي وصلت إليه: ${level}`,
      `نسبة الدقة: ${acc}`,
      `متوسط وقت الإجابة: ${avg}`,
      `أداؤك: ${perf}`,
      '🎉 تهانينا! لقد أكملت المسابقة بنجاح! 🎉',
      '',
      '🔗 جرب تحديك أنت أيضًا!',
      window.location.href
    ].join('\n');
  },

  shareOnX() {
    const text = this.getShareTextForX();
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      text
    )}`;
    window.open(url, '_blank');
  },

  shareOnInstagram() {
    const text = this.getShareTextForX();
    navigator.clipboard
      .writeText(text)
      .then(() => this.showToast('تم نسخ النتيجة لمشاركتها!', 'success'))
      .catch(() => this.showToast('فشل نسخ النتيجة.', 'error'));
  },

  /* ———————————————— تشخيص وسجلات ———————————————— */
  getAutoDiagnostics() {
    try {
      const nav = navigator || {};
      const conn = nav.connection || {};
      const perf = performance || {};
      const mem = perf.memory || {};
      const activeScreen =
        Object.entries(this.dom.screens).find(([, el]) =>
          el.classList.contains('active')
        )?.[0] || 'unknown';
      return {
        url: location.href,
        userAgent: nav.userAgent || '',
        platform: nav.platform || '',
        language: nav.language || '',
        viewport: {
          w: window.innerWidth,
          h: window.innerHeight,
          dpr: window.devicePixelRatio || 1
        },
        connection: {
          type: conn.effectiveType || '',
          downlink: conn.downlink || '',
          rtt: conn.rtt || ''
        },
        performance: {
          memory: {
            jsHeapSizeLimit: mem.jsHeapSizeLimit || null,
            totalJSHeapSize: mem.totalJSHeapSize || null,
            usedJSHeapSize: mem.usedJSHeapSize || null
          },
          timingNow: perf.now ? Math.round(perf.now()) : null
        },
        appState: {
          screen: activeScreen,
          level:
            this.config.LEVELS[this.gameState?.level || 0]?.name || null,
          questionIndex: this.gameState?.questionIndex ?? null,
          score: this.gameState?.currentScore ?? null
        },
        recentErrors: this.recentErrors || []
      };
    } catch (e) {
      return { error: String(e) };
    }
  },

  buildQuestionRef() {
    const levelObj = this.config.LEVELS[this.gameState.level] || {};
    const levelName = levelObj.name || '';
    const levelLabel = levelObj.label || '';
    const qIndex1 = (this.gameState.questionIndex ?? 0) + 1;
    const total = (this.gameState.shuffledQuestions || []).length;
    const qText = (this.dom.questionText?.textContent || '').trim();
    const options = [...this.getAllEl('.option-btn')].map((b) =>
      (b.textContent || '').trim()
    );
    const hash = this.simpleHash(
      `${levelName}|${qIndex1}|${qText}|${options.join('|')}`
    );
    return {
      level_name: levelName,
      level_label: levelLabel,
      question_index: qIndex1,
      total_questions: total,
      question_text: qText,
      options,
      ref: `${levelName}:${qIndex1}:${hash.slice(0, 6)}`
    };
  },

  simpleHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    return String(Math.abs(h));
  },

  async sendClientLog(event = 'log', payload = {}) {
    try {
      await this.edgeFetch('clientLog', {
        event,
        payload,
        session_id:
          this.gameState?.sessionId || this.currentSessionId || '',
        device_id: this.gameState?.deviceId || this.getOrSetDeviceId(),
        time: new Date().toISOString()
      });
    } catch (_) {}
  },

  /* ———————————————— جهاز ومؤقّت تبريد ———————————————— */
  getOrSetDeviceId() {
    let deviceId;
    try {
      deviceId = localStorage.getItem('quizGameDeviceId');
    } catch (_) {}
    if (!deviceId) {
      deviceId =
        'D' +
        Date.now().toString(36) +
        Math.random().toString(36).substring(2, 11).toUpperCase();
      try {
        localStorage.setItem('quizGameDeviceId', deviceId);
      } catch (_) {}
    }
    return deviceId;
  },

  getCooldownKey() {
    const device = this.gameState?.deviceId || this.getOrSetDeviceId();
    return `quizCooldown:${device}`;
  },

  setCooldown(seconds = this.config.COOLDOWN_SECONDS) {
    const until = Date.now() + Math.max(1, seconds) * 1000;
    try {
      localStorage.setItem(this.getCooldownKey(), String(until));
    } catch (_) {}
  },

  getCooldownRemaining() {
    try {
      const v = Number(localStorage.getItem(this.getCooldownKey()) || 0);
      const diff = Math.ceil((v - Date.now()) / 1000);
      return Math.max(0, diff);
    } catch (_) {
      return 0;
    }
  },

  clearCooldown() {
    try {
      localStorage.removeItem(this.getCooldownKey());
    } catch (_) {}
  }
});

/* ———————————————— إقلاع عند تحميل الصفحة ———————————————— */
document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.body.dataset.theme = savedTheme;
  const toggleBtn = document.querySelector('.theme-toggle-btn');
  if (toggleBtn) toggleBtn.textContent = savedTheme === 'dark' ? ICON_SUN : ICON_MOON;
  new QuizGame();
});
/* نهاية المرحلة ٣ */
