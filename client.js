/**
 * dsh-niuma-timer — Client half (browser)
 *
 * 牛马费用计时器 · 手帐风格：输入月薪与上下班时间，实时显示今天已挣多少、
 * 本周/本月累计多少，贴在输入框下方（`conversation.composer.dock`）。
 *
 * Contract: `{ inject: ['slots'], apply(ctx) }`. The factory is side-effect
 * free; styles are installed inside `apply` through `ctx.effect` so unloading
 * the plugin removes them. React comes from the shell's module table, no other
 * Harness client package is imported. State lives in the page's localStorage.
 */
window.__ModuleLoader__.load({
  id: 'dsh-niuma-timer',
  factory(require) {
    var React = require('react')
    var h = React.createElement
    // `react-dom` is a public seed module of the web client. The expanded panel is
    // portalled to <body> so it can float above the composer without taking any
    // space in the dock; when the module is absent we fall back to rendering it
    // in place (still position:fixed, still measured from the chip).
    var ReactDOM = null
    try {
      var domCandidate = require('react-dom')
      if (domCandidate && typeof domCandidate.createPortal === 'function') { ReactDOM = domCandidate }
    } catch (e) { ReactDOM = null }

    // ---------- constants ----------
    var STORE_KEY = 'dsh-niuma-timer.v1'
    var DEFAULTS = {
      salary: 12000,
      start: '09:00',
      end: '18:00',
      breakStart: '12:00',
      breakMin: 60,
      workdays: 0,
      // ---- 迷你仪表盘显示设置 ----
      mode: 'full',        // 'mini' | 'full' | 'fun'
      hideMoney: false,    // 隐藏所有金额，只留工作进度
      hidden: false,       // 一键隐藏胶囊（留一个极小的恢复点）
      place: 'center',     // 'left' | 'center' | 'right'
      density: 'cozy',     // 'compact' | 'cozy'
      fields: {
        amount: true,
        progress: true,
        month: true,
        status: true,
        remain: true,
        rate: false
      },
      // ---- 下班保护（默认全关，三项独立） ----
      notify: {
        preEnd: false,     // 计划下班前提醒一次
        lead: 10,          // 提前几分钟：5 | 10 | 15 | 30
        atEnd: false,      // 到点提醒一次
        overtime: false    // 面板/胶囊里显示「已超过计划下班时间 N 分钟」
      }
    }

    /** 显示模式与字段：顺序即渲染顺序。 */
    var MODES = ['mini', 'full', 'fun']
    var FIELD_IDS = ['amount', 'progress', 'month', 'status', 'remain', 'rate']
    var PLACES = ['left', 'center', 'right']
    var DENSITIES = ['compact', 'cozy']
    var LEADS = [5, 10, 15, 30]

    /** 合并保存的配置：深拷贝 DEFAULTS（fields / notify 是嵌套对象，不能共享引用）。 */
    function cloneDefaults() {
      var out = {}
      for (var k in DEFAULTS) {
        var v = DEFAULTS[k]
        if (v && typeof v === 'object') {
          out[k] = {}
          for (var f in v) { out[k][f] = v[f] }
        } else {
          out[k] = v
        }
      }
      return out
    }

    /** Host context captured in `apply`, read by the components for locale. */
    var hostCtx = null

    var STR = {
      zh: {
        chipLabel: '牛马费',
        chipToday: '今日 {p}%',
        chipMonth: '本月 ¥{v}',
        title: '今日牛马费',
        stWorking: '打工中',
        stBreak: '午休中',
        stOff: '已下班',
        stOvertime: '无偿加班',
        stIdle: '未开工',
        stRest: '休息日',
        perSec: '每秒 +{v} 元',
        capped: '今日计费已封顶',
        workedLine: '已上 {a} · 还剩 {b}',
        idleLine: '还没开工 · {t} 开始计费',
        restLine: '今天休息，牛马费暂停累计',
        offLine: '今日满额 ¥{v} · 快走，别回头',
        otLine: '今日满额 ¥{a} · 白干 {b}',
        progress: '完成 {p}%',
        remain: '距下班 {t}',
        finished: '今日已收工',
        dayPay: '日薪',
        hourPay: '时薪',
        secPay: '秒薪',
        monthTotal: '本月累计',
        monthDone: '已完成 {n}/{m} 个工作日',
        monthLeft: '还剩 {n} 个工作日',
        monthRatio: '本月已挣 {p}% 月薪',
        dots: '工作日打卡',
        setup: '记一下我的情况',
        edit: '改数据',
        close: '收起来',
        salaryLabel: '月薪（元，到手）',
        startLabel: '上班时间',
        endLabel: '下班时间',
        breakStartLabel: '午休开始',
        breakMinLabel: '午休时长（分钟）',
        workdaysLabel: '本月应出勤天数',
        workdaysHint: '填 0 = 按周一到周五自动算（本月 {n} 天）',
        save: '存下来',
        saved: '存好了',
        errSalary: '月薪得大于 0',
        errTime: '上下班时间要填完整（例如 09:00）',
        errOrder: '下班时间要晚于上班时间',
        errBreak: '午休开始要在上下班之间',
        errNet: '扣掉午休后没有工作时间了',
        errDays: '应出勤天数填 0–31',
        unitH: '小时',
        unitM: '分',
        foot: '按到手月薪折算，法定节假日请手动改应出勤天数',

        // ---- 迷你仪表盘 ----
        mode: '显示方案',
        modeMini: '极简',
        modeFull: '完整',
        modeFun: '趣味',
        modeMiniHint: '一行数字 + 进度',
        modeFullHint: '金额、进度条、本月与状态',
        modeFunHint: '大金额 + 状态章 + 文案',
        miniToday: '今日已赚',
        miniProgress: '今日进度',
        funLabel: '今日打工收益',
        funTicking: '每秒收入持续增加中…',
        funFrozen: '今日收益已封顶',
        funToday: '今日打工收益',
        remainBadge: '距离解放还有 {t}',
        remainBadgeDone: '已经解放啦',
        remainBadgeOt: '白干 {t}',
        densityLabel: '显示密度',
        densityCompact: '紧凑',
        densityCozy: '舒适',
        placeLabel: '胶囊位置',
        placeLeft: '靠左',
        placeCenter: '居中',
        placeRight: '靠右',
        fieldsLabel: '显示哪些数字',
        fieldAmount: '今日金额',
        fieldProgress: '今日进度',
        fieldMonth: '本月累计',
        fieldStatus: '状态章',
        fieldRemain: '下班倒计时',
        fieldRate: '每秒进账',
        hideMoneyLabel: '隐藏金额（只显示进度）',
        hideChipLabel: '隐藏胶囊',
        hideChipHint: '隐藏后右下角会出现一个小圆点，点它回来',
        showChip: '显示牛马费胶囊',
        displayTitle: '显示设置',
        moneyHidden: '金额已隐藏',

        // ---- 今日时间轴（只读） ----
        tlTitle: '今日时间轴',
        tlStart: '上班',
        tlEnd: '下班',
        tlBreak: '午休',
        tlBefore: '尚未上班',
        tlAfter: '已到计划下班时间',
        tlNoSchedule: '时间还没配全',
        tlNeedTimes: '在「改数据」里填上上下班时间，这里才会画出今天的时间轴。',
        tlProgress: '已工作 {a} / 计划 {b}',

        // ---- 下班保护 ----
        notifyTitle: '下班保护',
        notifyLead: '只提醒工作边界，不是考勤',
        preEndLabel: '下班前提醒',
        leadLabel: '提前',
        lead5: '5 分',
        lead10: '10 分',
        lead15: '15 分',
        lead30: '30 分',
        atEndLabel: '到点提醒',
        overtimeLabel: '下班后超时状态',
        overtimeHint: '在面板里显示「已超过计划下班时间 X 分钟」，随时间更新，不弹窗',
        notifyNote: '三项默认关闭、可单独开关；同一提醒每天最多一次。不记录你的实际下班时间，也不算加班收入。',
        otJustNow: '已超过计划下班时间不到 1 分钟',
        otOvertime: '已超过计划下班时间 {n} 分钟',
        otBadge: '超时 {n} 分',
        remPreEnd: '还有 {t} 就到计划下班时间',
        remAtEnd: '到计划下班时间了（{t}）'
      },
      en: {
        chipLabel: 'Work-yield',
        chipToday: 'today {p}%',
        chipMonth: 'month ¥{v}',
        title: "Today's earnings",
        stWorking: 'on the clock',
        stBreak: 'lunch break',
        stOff: 'clocked out',
        stOvertime: 'unpaid overtime',
        stIdle: 'not started',
        stRest: 'day off',
        perSec: '+{v} / sec',
        capped: 'capped for today',
        workedLine: '{a} in · {b} left',
        idleLine: 'Not started · billing begins at {t}',
        restLine: 'Day off — nothing is accruing',
        offLine: 'Full day ¥{v} · go home',
        otLine: 'Full day ¥{a} · {b} unpaid',
        progress: '{p}% done',
        remain: '{t} to go',
        finished: 'Done for today',
        dayPay: 'day',
        hourPay: 'hour',
        secPay: 'sec',
        monthTotal: 'This month',
        monthDone: '{n}/{m} workdays done',
        monthLeft: '{n} workdays left',
        monthRatio: '{p}% of salary earned',
        dots: 'Workday check-in',
        setup: 'My settings',
        edit: 'Edit',
        close: 'Close',
        salaryLabel: 'Monthly pay (net, CNY)',
        startLabel: 'Start',
        endLabel: 'End',
        breakStartLabel: 'Break starts',
        breakMinLabel: 'Break length (min)',
        workdaysLabel: 'Workdays this month',
        workdaysHint: '0 = count Mon–Fri automatically ({n} this month)',
        save: 'Save',
        saved: 'Saved',
        errSalary: 'Monthly pay must be above 0',
        errTime: 'Fill in both start and end times (for example 09:00)',
        errOrder: 'End time must be after start time',
        errBreak: 'Break must start between start and end',
        errNet: 'No working time left after the break',
        errDays: 'Workdays must be 0–31',
        unitH: 'h',
        unitM: 'm',
        foot: 'Based on net pay; adjust workdays for holidays',

        // ---- mini dashboard ----
        mode: 'Layout',
        modeMini: 'Minimal',
        modeFull: 'Full',
        modeFun: 'Playful',
        modeMiniHint: 'one figure plus progress',
        modeFullHint: 'amount, bar, month and status',
        modeFunHint: 'big amount, badge, caption',
        miniToday: 'Earned today',
        miniProgress: 'progress',
        funLabel: "Today's work yield",
        funTicking: 'Still ticking up…',
        funFrozen: "Capped for today",
        funToday: "Today's work yield",
        remainBadge: '{t} until freedom',
        remainBadgeDone: 'Already free',
        remainBadgeOt: '{t} unpaid',
        densityLabel: 'Density',
        densityCompact: 'Compact',
        densityCozy: 'Cozy',
        placeLabel: 'Chip position',
        placeLeft: 'Left',
        placeCenter: 'Center',
        placeRight: 'Right',
        fieldsLabel: 'Which figures to show',
        fieldAmount: "Today's amount",
        fieldProgress: "Today's progress",
        fieldMonth: 'This month',
        fieldStatus: 'Status badge',
        fieldRemain: 'Time left',
        fieldRate: 'Per second',
        hideMoneyLabel: 'Hide amounts (progress only)',
        hideChipLabel: 'Hide the chip',
        hideChipHint: 'A small dot stays in the bottom-right corner — click it to bring the chip back',
        showChip: 'Show the work-yield chip',
        displayTitle: 'Display',
        moneyHidden: 'Amounts hidden',

        // ---- today's timeline (read-only) ----
        tlTitle: "Today's hours",
        tlStart: 'Start',
        tlEnd: 'End',
        tlBreak: 'Break',
        tlBefore: 'Not started yet',
        tlAfter: 'Past the planned end time',
        tlNoSchedule: 'Times incomplete',
        tlNeedTimes: "Fill in your start and end times under Edit to draw today's timeline.",
        tlProgress: '{a} worked / {b} planned',

        // ---- end-of-day guard ----
        notifyTitle: 'End of day',
        notifyLead: 'Boundary reminders only — not time tracking',
        preEndLabel: 'Warn before the end time',
        leadLabel: 'Lead',
        lead5: '5m',
        lead10: '10m',
        lead15: '15m',
        lead30: '30m',
        atEndLabel: 'Remind at the end time',
        overtimeLabel: 'Show overtime status',
        overtimeHint: 'Shows how long you are past the planned end time in the panel; updates live, no popups',
        notifyNote: 'All three are off by default and toggle independently; each reminder fires at most once a day. Your actual clock-out time is never recorded, and overtime never counts as earnings.',
        otJustNow: 'Past the planned end time by less than a minute',
        otOvertime: 'Past the planned end time by {n} min',
        otBadge: '{n}m over',
        remPreEnd: '{t} until your planned end time',
        remAtEnd: 'Planned end time reached ({t})'
      }
    }

    function tr(locale, key, vars) {
      var dict = STR[locale] || STR.zh
      var s = dict[key] !== undefined ? dict[key] : (STR.zh[key] !== undefined ? STR.zh[key] : key)
      if (vars) {
        s = s.replace(/\{(\w+)\}/g, function (m, k) {
          return vars[k] !== undefined ? vars[k] : m
        })
      }
      return s
    }

    function readLocale() {
      try {
        var svc = hostCtx && hostCtx.locale
        var active = svc && typeof svc.getLocale === 'function' ? svc.getLocale().active : ''
        if (active === 'zh' || active === 'en') { return active }
      } catch (e) { /* locale service absent */ }
      var lang = (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || ''
      return lang.indexOf('en') === 0 ? 'en' : 'zh'
    }

    // ---------- storage ----------
    function oneOf(value, allowed, fallback) {
      return allowed.indexOf(value) >= 0 ? value : fallback
    }

    function readCfg() {
      var out = cloneDefaults()
      try {
        var raw = localStorage.getItem(STORE_KEY)
        if (raw) {
          var saved = JSON.parse(raw)
          for (var key in out) {
            if (out[key] && typeof out[key] === 'object') { continue }
            if (saved[key] !== undefined && saved[key] !== null && saved[key] !== '') { out[key] = saved[key] }
          }
          if (saved.fields && typeof saved.fields === 'object') {
            for (var f in out.fields) {
              if (typeof saved.fields[f] === 'boolean') { out.fields[f] = saved.fields[f] }
            }
          }
          if (saved.notify && typeof saved.notify === 'object') {
            out.notify.preEnd = saved.notify.preEnd === true
            out.notify.atEnd = saved.notify.atEnd === true
            out.notify.overtime = saved.notify.overtime === true
            out.notify.lead = oneOf(Number(saved.notify.lead), LEADS, 10)
          }
        }
      } catch (e) { /* keep defaults */ }
      // 枚举值做一次白名单校正：旧版本存下的或手改坏的值不该让界面崩掉。
      out.mode = oneOf(out.mode, MODES, 'full')
      out.place = oneOf(out.place, PLACES, 'center')
      out.density = oneOf(out.density, DENSITIES, 'cozy')
      out.hideMoney = out.hideMoney === true
      out.hidden = out.hidden === true
      return out
    }

    function writeCfg(cfg) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)) } catch (e) { /* ignore */ }
    }

    // 提醒的「今天已经响过」账本：与配置分开存，按自然日滚动。
    // 只记 preEnd / atEnd 两类弹窗，超时状态是持续显示、不需要去重。
    var FIRE_KEY = 'dsh-niuma-timer.fired.v1'

    function dayKey(d) {
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
    }

    function readFired() {
      var empty = { day: '', preEnd: false, atEnd: false }
      try {
        var raw = localStorage.getItem(FIRE_KEY)
        if (!raw) { return empty }
        var saved = JSON.parse(raw)
        return {
          day: typeof saved.day === 'string' ? saved.day : '',
          preEnd: saved.preEnd === true,
          atEnd: saved.atEnd === true
        }
      } catch (e) { return empty }
    }

    function writeFired(v) {
      try { localStorage.setItem(FIRE_KEY, JSON.stringify(v)) } catch (e) { /* ignore */ }
    }

    /** 合并更新：浅合并顶层，嵌套对象逐键合并，避免调用方漏字段时丢设置。 */
    function mergeCfg(base, patch) {
      var next = {}
      var k, f
      for (k in base) {
        var bv = base[k]
        if (bv && typeof bv === 'object') {
          next[k] = {}
          for (f in bv) { next[k][f] = bv[f] }
        } else {
          next[k] = bv
        }
      }
      for (var key in patch) {
        if (!(key in next)) { continue }
        var pv = patch[key]
        if (pv && typeof pv === 'object' && next[key] && typeof next[key] === 'object') {
          for (var nk in pv) {
            if (!(nk in next[key])) { continue }
            var cur = next[key][nk]
            if (typeof cur === 'boolean') { next[key][nk] = pv[nk] === true }
            else if (typeof cur === 'number') { next[key][nk] = Number(pv[nk]) || 0 }
            else { next[key][nk] = pv[nk] }
          }
        } else {
          next[key] = pv
        }
      }
      next.mode = oneOf(next.mode, MODES, 'full')
      next.place = oneOf(next.place, PLACES, 'center')
      next.density = oneOf(next.density, DENSITIES, 'cozy')
      next.notify.lead = oneOf(Number(next.notify.lead), LEADS, 10)
      next.notify.preEnd = next.notify.preEnd === true
      next.notify.atEnd = next.notify.atEnd === true
      next.notify.overtime = next.notify.overtime === true
      return next
    }

    // ---------- time helpers ----------
    function toSec(hhmm) {
      var parts = String(hhmm || '0:0').split(':')
      var hh = parseInt(parts[0], 10) || 0
      var mm = parseInt(parts[1], 10) || 0
      return hh * 3600 + mm * 60
    }

    function pad2(n) { return n < 10 ? '0' + n : '' + n }

    function splitDur(sec) {
      sec = Math.max(0, Math.floor(sec))
      return { h: Math.floor(sec / 3600), m: Math.floor((sec % 3600) / 60), s: sec % 60 }
    }

    function durTxt(sec, T) {
      var d = splitDur(sec)
      if (d.h > 0) { return d.h + ' ' + T('unitH') + ' ' + d.m + ' ' + T('unitM') }
      return d.m + ' ' + T('unitM')
    }

    function clockTxt(sec) {
      var d = splitDur(sec)
      return pad2(d.h) + ':' + pad2(d.m) + ':' + pad2(d.s)
    }

    function money(n) {
      if (!isFinite(n)) { n = 0 }
      var s = n.toFixed(2)
      var parts = s.split('.')
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      return parts.join('.')
    }

    function isWeekend(d) {
      var w = d.getDay()
      return w === 0 || w === 6
    }

    function autoWorkdays(d) {
      var y = d.getFullYear()
      var m = d.getMonth()
      var days = new Date(y, m + 1, 0).getDate()
      var count = 0
      for (var i = 1; i <= days; i++) {
        if (!isWeekend(new Date(y, m, i))) { count++ }
      }
      return count
    }

    function workdaysBeforeToday(d) {
      var count = 0
      for (var i = 1; i < d.getDate(); i++) {
        if (!isWeekend(new Date(d.getFullYear(), d.getMonth(), i))) { count++ }
      }
      return count
    }

    // ---------- 今日时间轴（只读） ----------
    // 所有节点都从现有设置推导：没有午休配置就不画午休区间；上下班缺一个就没有
    // 可用量程——此时不画刻度、不给百分比、不给倒计时，只把已知节点列出来。
    function validTime(v) {
      return typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v.trim())
    }

    function hmTxt(sec) {
      var d = splitDur(sec)
      return pad2(d.h) + ':' + pad2(d.m)
    }

    function timelineOf(cfg, now) {
      var hasStart = validTime(cfg.start)
      var hasEnd = validTime(cfg.end)
      var startSec = hasStart ? toSec(cfg.start) : null
      var endSec = hasEnd ? toSec(cfg.end) : null
      var ordered = hasStart && hasEnd && endSec > startSec

      var bmSec = Math.max(0, Number(cfg.breakMin) || 0) * 60
      var hasBreak = false
      var bsSec = null
      var beSec = null
      if (ordered && validTime(cfg.breakStart) && bmSec > 0) {
        var b = toSec(cfg.breakStart)
        if (b >= startSec && b < endSec) {
          hasBreak = true
          bsSec = b
          beSec = Math.min(b + bmSec, endSec)
        }
      }

      var nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
      var nowPct = null
      var phase = 'unknown'
      if (ordered) {
        nowPct = clamp((nowSec - startSec) / (endSec - startSec), 0, 1)
        phase = nowSec < startSec ? 'before' : (nowSec >= endSec ? 'after' : 'during')
      }

      // 进度只在排班完整、且扣掉午休后仍有计划工时的情况下才算；
      // 午休不计入计划工作时长。
      var planned = null
      var worked = null
      var ratio = null
      if (ordered) {
        var p = (endSec - startSec) - (hasBreak ? (beSec - bsSec) : 0)
        if (p > 0) {
          var t = Math.min(Math.max(nowSec, startSec), endSec)
          var w = t - startSec
          if (hasBreak) { w -= Math.max(0, Math.min(t, beSec) - bsSec) }
          planned = p
          worked = Math.max(0, Math.min(w, p))
          ratio = worked / p
        }
      }

      return {
        hasStart: hasStart,
        hasEnd: hasEnd,
        ordered: ordered,
        startSec: startSec,
        endSec: endSec,
        hasBreak: hasBreak,
        bsSec: bsSec,
        beSec: beSec,
        nowPct: nowPct,
        phase: phase,
        planned: planned,
        worked: worked,
        ratio: ratio
      }
    }

    // ---------- core ----------
    function compute(cfg, now) {
      var startSec = toSec(cfg.start)
      var endSec = toSec(cfg.end)
      var bsSec = toSec(cfg.breakStart)
      var bmSec = Math.max(0, Number(cfg.breakMin) || 0) * 60

      if (endSec <= startSec) { endSec = startSec + 3600 }
      if (bsSec < startSec) { bsSec = startSec }
      if (bsSec > endSec) { bsSec = endSec }
      var beSec = Math.min(bsSec + bmSec, endSec)
      var netSec = Math.max(1, (endSec - startSec) - (beSec - bsSec))

      var manual = Number(cfg.workdays) || 0
      var totalWorkdays = manual > 0 ? Math.min(31, Math.max(1, Math.round(manual))) : autoWorkdays(now)

      var salary = Math.max(0, Number(cfg.salary) || 0)
      var dayPay = totalWorkdays > 0 ? salary / totalWorkdays : 0
      var doneDays0 = workdaysBeforeToday(now)

      // 排班不完整（时间缺失或写坏）：不猜时间，也不猜今天的收入。
      // 今日按 0 计，月收入仍只累计已经走完的工作日 —— 不虚构、不出现负时长。
      if (!validTime(cfg.start) || !validTime(cfg.end)) {
        return {
          status: 'rest',
          incomplete: true,
          dayPay: 0,
          hourPay: 0,
          secPay: 0,
          todayEarn: 0,
          worked: 0,
          remain: 0,
          overtime: 0,
          progress: 0,
          totalWorkdays: totalWorkdays,
          autoWorkdays: autoWorkdays(now),
          doneDays: doneDays0,
          monthEarn: Math.min(salary, dayPay * doneDays0),
          salary: salary,
          netSec: 1
        }
      }

      var secPay = dayPay / netSec

      var nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000
      var weekend = isWeekend(now)
      var worked = 0
      var status = 'working'

      if (weekend) {
        status = 'rest'
      } else if (nowSec < startSec) {
        status = 'idle'
      } else if (nowSec >= endSec) {
        worked = netSec
        status = nowSec - endSec > 60 ? 'overtime' : 'off'
      } else if (nowSec < bsSec) {
        worked = nowSec - startSec
      } else if (nowSec < beSec) {
        worked = bsSec - startSec
        status = 'break'
      } else {
        worked = (bsSec - startSec) + (nowSec - beSec)
      }

      worked = Math.max(0, Math.min(worked, netSec))

      var todayEarn = dayPay * (worked / netSec)
      var doneDays = workdaysBeforeToday(now)
      var monthEarn = Math.min(salary, dayPay * doneDays + todayEarn)

      return {
        status: status,
        dayPay: dayPay,
        hourPay: dayPay / (netSec / 3600),
        secPay: secPay,
        todayEarn: todayEarn,
        worked: worked,
        remain: Math.max(0, netSec - worked),
        overtime: weekend ? 0 : Math.max(0, nowSec - endSec),
        progress: worked / netSec,
        totalWorkdays: totalWorkdays,
        autoWorkdays: autoWorkdays(now),
        doneDays: doneDays,
        monthEarn: monthEarn,
        salary: salary,
        netSec: netSec
      }
    }

    // ---------- styles ----------
    // The dock row only ever holds the *collapsed* chip. Everything the chip
    // expands into is a floating layer (`position:fixed`, portalled to <body>),
    // so opening the panel never adds height to the dock, the composer seat or
    // the conversation column.
    var CSS = [
      "@font-face{font-family:\"NT WenKai\";font-style:normal;font-weight:400;font-display:swap;src:url(data:font/woff2;base64,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) format(\"woff2\")}'",
      /* 宿主 dock（[data-composer-dock]）是 display:flex + gap:12px 的一行，原生 activity/usage
         按钮也是它的直接子节点。这里只让 slot 锚点（display:contents，不参与布局）透出胶囊，
         胶囊作为 dock 的同级 flex 项：各自按内容占宽、不许互相挤压（flex:0 1 auto + min-width:0），
         超出余量时整行换行 —— 任一方都不会被裁掉。不改宿主容器的任何属性。 */
      '.nt-wrap{display:flex;flex-direction:column;align-items:center;gap:8px;font-family:"NT WenKai","Kaiti SC","Songti SC",system-ui,sans-serif;box-sizing:border-box;flex:0 1 auto;min-width:0;max-width:100%;align-self:center}',
      '.nt-wrap *,.nt-wrap *::before,.nt-wrap *::after{box-sizing:border-box}',

      /* collapsed chip */
      '.nt-chip{display:flex;align-items:center;gap:9px;max-width:100%;min-width:0;overflow:hidden;padding:4px 13px 5px;background:#FBF5E8;background-image:repeating-linear-gradient(to bottom,transparent 0 14px,rgba(120,170,195,.16) 14px 15px);border:1.5px solid #332F2A;border-radius:13px 17px 12px 18px/16px 12px 18px 13px;box-shadow:2px 2px 0 rgba(51,47,42,.14);cursor:pointer;color:#332F2A;font-size:12.5px;line-height:1.6;letter-spacing:.4px;transition:transform .12s ease,box-shadow .12s ease}',
      '.nt-chip:hover{transform:translate(-1px,-1px);box-shadow:3px 3px 0 rgba(51,47,42,.16)}',
      '.nt-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2563eb);outline-offset:2px}',
      '.nt-chip[aria-expanded="true"]{transform:translate(0,-2px);box-shadow:2px 4px 0 rgba(51,47,42,.16);background-color:rgba(255,253,246,.86);-webkit-backdrop-filter:blur(14px) saturate(1.3);backdrop-filter:blur(14px) saturate(1.3)}',
      '.nt-dot{width:6px;height:6px;border-radius:50%;background:#D2605A;flex:0 0 auto}',
      '.nt-dot.idle{background:#9A9285}',
      '.nt-dot.live{animation:nt-pulse 1.8s infinite}',
      '@keyframes nt-pulse{0%{box-shadow:0 0 0 0 rgba(210,96,90,.45)}70%{box-shadow:0 0 0 6px rgba(210,96,90,0)}100%{box-shadow:0 0 0 0 rgba(210,96,90,0)}}',
      '.nt-chip-main{display:inline-flex;align-items:center;gap:7px;min-width:0;flex:0 1 auto}',
      '.nt-chip-line{display:inline-flex;align-items:center;gap:5px;min-width:0;flex:0 1 auto;overflow:hidden}',
      /* 与原生统计胶囊同一行时（dock 的 gap 已给 12px），胶囊只按内容占宽，
         不抢 flex 增长份额，也不允许原生的 activity/usage 被它挤出可视区。 */
      '@media (max-width:640px){.nt-chip{font-size:12px;gap:7px;padding:3px 10px 4px}.nt-chip-val{font-size:13px}.nt-chip-sub{display:none}}',
      /* 窄视口：胶囊必须能在 dock 里收缩。所有子项允许收缩 + 文本省略，
         先丢最不关键的信息（本月 → 倒计时徽章 → 进度小段），保证永不溢出。 */
      '.nt-chip{flex-wrap:nowrap}',
      /* 兜底：任何模式下所有子项都不许把胶囊撑出容器 */
      '.nt-chip>*{min-width:0}',
      '.nt-money.nt-chip-sub{overflow:hidden;text-overflow:ellipsis}',
      '.nt-chip-val{font-family:"DIN Alternate",ui-monospace,"SF Mono",Menlo,monospace;font-weight:700;font-size:14px;font-variant-numeric:tabular-nums;color:#332F2A}',
      '.nt-chip-sep{color:#C9BFAA}',
      '.nt-chip-sub{color:#6D6558;white-space:nowrap}',
      '.nt-caret{color:#8A8275;font-size:10px;transform:translateY(1px)}',

      /* ---------- 三种显示方案 ----------
         A 极简：一行 `● 今日已赚 ¥398.55 —— 70%`，金额与进度分列两端。
         B 完整：两行 —— 主行「牛马费 ¥398.55 · 状态章」，次行进度条 + 本月。
         C 趣味：主行「🐮 今日打工收益 · 距解放倒计时」，金额换行放大，底部一句状态文案。
         三种都遵守同一个横向预算：flex:0 1 auto + min-width:0，不抢原生胶囊的位置。 */
      '.nt-chip--mini{gap:10px;padding:5px 14px 6px}',
      '.nt-chip--mini .nt-mini-main{display:inline-flex;align-items:center;gap:7px;min-width:0;flex:0 1 auto;overflow:hidden}',
      '.nt-chip--mini .nt-mini-amount{font-family:"DIN Alternate",ui-monospace,"SF Mono",Menlo,monospace;font-weight:700;font-size:14px;font-variant-numeric:tabular-nums;letter-spacing:-.2px}',
      '.nt-chip--mini .nt-mini-track{display:block;flex:0 0 auto;width:52px;height:5px;border-radius:3px;overflow:hidden;background:#D9D2BE}',
      '.nt-chip--mini .nt-mini-fill{display:block;height:100%;border-radius:3px;background:#7FA36B;transition:width .3s ease}',
      '.nt-chip--mini .nt-mini-pct{font-family:"DIN Alternate",ui-monospace,"SF Mono",Menlo,monospace;font-size:11.5px;font-variant-numeric:tabular-nums;color:#6D6558;min-width:30px;text-align:right}',

      /* 完整：单行横排 —— 状态点 + 标签 + 金额 + 状态章 + 小进度条 + 百分比 + 本月 + 角标 */
      '.nt-chip--full{gap:8px;padding:5px 13px 6px}',
      '.nt-chip--full .nt-full-main{display:inline-flex;align-items:baseline;gap:7px;min-width:0;flex:0 1 auto;overflow:hidden}',
      '.nt-chip--full .nt-full-badge{flex:0 0 auto;padding:1px 8px;font-size:10.5px;letter-spacing:.6px;border-radius:999px;background:rgba(127,163,107,.18);color:#4F6B3E;border:1px solid rgba(127,163,107,.4);white-space:nowrap}',
      '.nt-chip--full .nt-full-badge.grey{background:rgba(138,130,117,.14);color:#6D6558;border-color:rgba(138,130,117,.34)}',
      '.nt-chip--full .nt-full-badge.red{background:rgba(210,96,90,.14);color:#9C3F3A;border-color:rgba(210,96,90,.36)}',
      '.nt-chip--full .nt-full-prog{display:inline-flex;align-items:center;gap:5px;flex:0 1 auto;min-width:0}',
      '.nt-chip--full .nt-full-track{display:block;flex:0 0 auto;width:44px;height:5px;border-radius:3px;overflow:hidden;background:#D9D2BE}',
      '.nt-chip--full .nt-full-fill{display:block;height:100%;border-radius:3px;background-color:#7FA36B;background-image:repeating-linear-gradient(45deg,#7FA36B 0 4px,#96B884 4px 8px);transition:width .3s ease}',
      '.nt-chip--full .nt-full-note{flex:0 0 auto;font-family:"DIN Alternate",ui-monospace,"SF Mono",Menlo,monospace;font-size:11px;font-variant-numeric:tabular-nums;color:#6D6558;white-space:nowrap}',

      /* 趣味：单行横排 —— 🐮 标签 + 金额（加重）+ 倒计时红章 + 角标 */
      '.nt-chip--fun{gap:9px;padding:5px 14px 6px;background-color:#FBF3E0;background-image:none}',
      '.nt-chip--fun .nt-fun-label{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:#6D6558;letter-spacing:.5px;white-space:nowrap;flex:0 0 auto}',
      '.nt-chip--fun .nt-chip-val,.nt-chip--fun .nt-progress-lead{font-size:16px;font-weight:800}',
      '.nt-chip--fun .nt-fun-badge{flex:0 1 auto;min-width:0;padding:1px 9px;font-size:10.5px;letter-spacing:.4px;border-radius:999px;background:rgba(210,96,90,.15);color:#9C3F3A;border:1px solid rgba(210,96,90,.32);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.nt-chip--fun .nt-fun-badge.grey{background:rgba(138,130,117,.13);color:#6D6558;border-color:rgba(138,130,117,.3)}',

      /* 隐藏金额时（hideMoney）：所有金额节点整体收起，进度/时间接管主位 */
      '.nt-chip[data-hide-money="true"] .nt-money{display:none}',
      '.nt-progress-lead{font-variant-numeric:tabular-nums}',

      /* 密度：紧凑只留一行、字号降一档；舒适是默认值 */
      '.nt-chip[data-density="compact"]{padding:2px 10px 3px;gap:7px;font-size:11.5px}',
      /* 极窄视口（分栏/手机竖屏）不能让固定最小宽度撑破 dock */
      '@media (max-width:380px){.nt-chip--full{min-width:0}}',
      '.nt-chip[data-density="compact"] .nt-chip-val,.nt-chip[data-density="compact"] .nt-mini-amount{font-size:12.5px}',
      '.nt-chip[data-density="compact"] .nt-chip-line{display:none}',

      /* 位置：只改 nt-wrap 在 dock 里的 align-self，不动宿主容器 */
      '.nt-wrap[data-place="left"]{align-self:flex-start}',
      '.nt-wrap[data-place="center"]{align-self:center}',
      '.nt-wrap[data-place="right"]{align-self:flex-end}',

      /* 一键隐藏后留下的恢复圆点：极小、半透明，悬停浮现 */
      '.nt-dot-restore{position:fixed;right:14px;bottom:12px;width:22px;height:22px;padding:0;display:flex;align-items:center;justify-content:center;font-size:11px;line-height:1;color:#6D6558;background:rgba(251,245,232,.72);border:1.4px dashed rgba(51,47,42,.4);border-radius:50%;cursor:pointer;z-index:29;opacity:.5;transition:opacity .15s ease,transform .15s ease;font-family:"NT WenKai","Kaiti SC",system-ui,sans-serif}',
      '.nt-dot-restore:hover,.nt-dot-restore:focus-visible{opacity:1;transform:scale(1.08);outline:none;border-style:solid}',

      /* 显示设置里的分段控件与开关 */
      '.nt-seg{display:inline-flex;flex:1 1 auto;min-width:0;gap:3px;padding:2px;border:1.4px solid rgba(51,47,42,.4);border-radius:9px;background:rgba(255,253,246,.6)}',
      '.nt-seg button{flex:1 1 0;min-width:0;padding:3px 6px;font-family:inherit;font-size:11.5px;color:#6D6558;background:none;border:0;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background-color .12s ease,color .12s ease}',
      '.nt-seg button:hover{color:#332F2A}',
      '.nt-seg button[aria-pressed="true"]{background:#EABF5C;color:#332F2A;font-weight:700}',
      '.nt-seg button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2563eb);outline-offset:1px}',
      '.nt-rowseg{display:flex;align-items:center;gap:8px;margin-bottom:8px;min-width:0}',
      '.nt-rowseg>label{flex:0 0 auto;font-size:11px;color:#6D6558;letter-spacing:1.1px}',
      '.nt-checks{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;margin:2px 0 10px}',
      '.nt-check{display:flex;align-items:center;gap:6px;font-size:11.5px;color:#4A443B;cursor:pointer;min-width:0}',
      '.nt-check input{flex:0 0 auto;margin:0;accent-color:#7FA36B}',
      '.nt-check span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.nt-switch{display:flex;align-items:center;gap:7px;font-size:11.5px;color:#4A443B;cursor:pointer;margin:0 0 7px}',
      '.nt-switch input{flex:0 0 auto;margin:0;accent-color:#7FA36B}',
      '.nt-modes{display:flex;gap:6px;margin:0 0 4px}',
      '.nt-modes>button{flex:1 1 0;min-width:0;padding:6px 4px;font-family:inherit;font-size:11.5px;line-height:1.3;color:#6D6558;background:rgba(255,253,246,.6);border:1.4px solid rgba(51,47,42,.4);border-radius:9px 11px 9px 12px/11px 9px 12px 9px;cursor:pointer;transition:border-color .12s ease,background-color .12s ease}',
      '.nt-modes>button:hover{border-color:rgba(51,47,42,.7)}',
      '.nt-modes>button[aria-pressed="true"]{border-color:#332F2A;background:rgba(234,191,92,.5);color:#332F2A;font-weight:700}',
      '.nt-modes>button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2563eb);outline-offset:1px}',
      '.nt-modehint{font-size:10.5px;color:#9A9285;margin:0 0 10px;min-height:13px}',

      /* floating layer: 展开后的整块内容都活在这里。它是 body 的直系子节点
         （ReactDOM.createPortal），position:fixed + inset:0 盖住视口，pointer-events:none
         让它对文档零侵入；只有卡片本身接收指针事件。层级低于宿主自己的 popover/dialog。 */
      '.nt-layer{position:fixed;inset:0;z-index:30;pointer-events:none;display:flex;justify-content:center;padding:12px 12px 12px;font-family:"NT WenKai","Kaiti SC","Songti SC",system-ui,sans-serif;color:#332F2A}',
      '.nt-layer *,.nt-layer *::before,.nt-layer *::after{box-sizing:border-box}',

      /* panel：半透明手帐纸。铺在聊天记录/输入框前方，透过它能看见下面的对话。
         宽度按底部胶囊量出来的位置对齐（--nt-left / --nt-width），高度以胶囊上沿为下限往上长。 */
      '.nt-panel{position:absolute;left:var(--nt-left,0px);width:var(--nt-width,560px);max-width:560px;bottom:calc(100% - var(--nt-top,0px));max-height:var(--nt-max-h,72vh);pointer-events:auto;display:flex;flex-direction:column;isolation:isolate;overflow:hidden;padding:14px 16px 12px;color:#332F2A;background-color:rgba(255,253,246,.84);background-image:repeating-linear-gradient(to bottom,transparent 0 25px,rgba(120,170,195,.16) 25px 26px);border:2px solid rgba(51,47,42,.9);border-radius:15px 21px 16px 23px/21px 15px 23px 16px;box-shadow:5px 6px 0 rgba(51,47,42,.10),0 22px 48px -20px rgba(60,45,20,.45);-webkit-backdrop-filter:blur(14px) saturate(1.3);backdrop-filter:blur(14px) saturate(1.3);animation:nt-pop .16s ease-out}',
      '@keyframes nt-pop{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}',
      '@media (prefers-reduced-motion:reduce){.nt-panel{animation:none}}',
      /* 卡片内的内容区：超出可视高度时只在卡片内部滚动，页面其余部分完全不动 */
      '.nt-body{min-height:0;overflow:auto;overscroll-behavior:contain;padding-right:2px;scrollbar-width:thin}',
      '.nt-body::-webkit-scrollbar{width:6px}',
      '.nt-body::-webkit-scrollbar-thumb{background:rgba(51,47,42,.18);border-radius:3px}',
      /* 指向胶囊的纸片小尾巴：视觉上把浮层和底部胶囊连起来 */
      '.nt-pointer{position:absolute;left:var(--nt-pointer,50%);bottom:-9px;width:16px;height:16px;transform:translateX(-50%) rotate(45deg);background:rgba(255,253,246,.9);border-right:2px solid rgba(51,47,42,.9);border-bottom:2px solid rgba(51,47,42,.9);border-bottom-right-radius:4px;pointer-events:none}',
      '.nt-tape{position:absolute;z-index:2;top:-11px;left:22px;width:76px;height:20px;background:repeating-linear-gradient(45deg,rgba(234,191,92,.62) 0 7px,rgba(234,191,92,.34) 7px 14px);border-left:2px dotted rgba(255,255,255,.55);border-right:2px dotted rgba(255,255,255,.55);transform:rotate(-5deg);pointer-events:none}',
      '.nt-head{display:flex;align-items:center;justify-content:space-between;gap:10px}',
      '.nt-title{font-size:15px;letter-spacing:1.6px}',
      '.nt-stamp{flex:0 0 auto;padding:3px 11px;font-size:11.5px;letter-spacing:1.4px;color:#D2605A;border:1.8px solid #D2605A;border-radius:46%/52%;box-shadow:inset 0 0 0 1.6px rgba(210,96,90,.18);transform:rotate(-6deg)}',
      '.nt-stamp.blue{color:#4C7B8C;border-color:#4C7B8C;box-shadow:inset 0 0 0 1.6px rgba(76,123,140,.16)}',
      '.nt-stamp.green{color:#6E8F5B;border-color:#6E8F5B;box-shadow:inset 0 0 0 1.6px rgba(127,163,107,.2)}',
      '.nt-stamp.grey{color:#8A8275;border-color:#8A8275;box-shadow:inset 0 0 0 1.6px rgba(138,130,117,.16)}',
      '.nt-amount{display:flex;align-items:baseline;gap:3px;margin-top:4px;font-family:"DIN Alternate",ui-monospace,"SF Mono",Menlo,monospace;font-variant-numeric:tabular-nums}',
      '.nt-amount .cur{font-size:18px;color:#6D6558;transform:translateY(-6px)}',
      '.nt-amount .val{font-size:34px;font-weight:800;line-height:1.15;letter-spacing:-.5px}',
      '.nt-rate{font-family:"DIN Alternate",ui-monospace,"SF Mono",Menlo,monospace;font-size:11.5px;color:#8A8275;letter-spacing:.3px}',
      '.nt-sub{margin-top:8px;font-size:13px;color:#4A443B;letter-spacing:.4px}',
      '.nt-sub b{font-family:"DIN Alternate",ui-monospace,"SF Mono",Menlo,monospace;font-size:13.5px}',
      '.nt-bar{height:13px;margin-top:9px;border:1.8px solid #332F2A;border-radius:9px 11px 9px 12px/11px 9px 12px 9px;background:repeating-linear-gradient(45deg,rgba(51,47,42,.05) 0 5px,transparent 5px 10px);overflow:hidden}',
      '.nt-fill{height:100%;background-color:#EABF5C;background-image:repeating-linear-gradient(45deg,#EABF5C 0 5px,#F2D180 5px 10px);transition:width .3s ease}',
      '.nt-barnote{display:flex;justify-content:space-between;margin-top:4px;font-family:"DIN Alternate",ui-monospace,"SF Mono",Menlo,monospace;font-size:11px;color:#8A8275}',
      '.nt-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:12px;padding-top:11px;border-top:1.5px dashed rgba(51,47,42,.22);text-align:center}',
      '.nt-meta .k{display:block;font-size:11px;color:#8A8275;letter-spacing:1.2px}',
      '.nt-meta .v{display:block;margin-top:2px;font-family:"DIN Alternate",ui-monospace,"SF Mono",Menlo,monospace;font-size:13.5px;font-weight:700;font-variant-numeric:tabular-nums}',
      '.nt-meta .cell+.cell{border-left:1px dashed rgba(51,47,42,.14)}',
      '.nt-dot-title{display:block;margin:12px 0 6px;font-size:11px;color:#8A8275;letter-spacing:1.6px}',
      '.nt-dots{display:flex;flex-wrap:wrap;gap:4px}',
      '.nt-day{width:14px;height:14px;border:1.4px solid rgba(51,47,42,.42);border-radius:4px 5px 4px 6px/5px 4px 6px 4px;background:#FFFDF6}',
      '.nt-day.done{background-color:#7FA36B;background-image:repeating-linear-gradient(45deg,#7FA36B 0 3px,#96B884 3px 6px);border-color:rgba(51,47,42,.5)}',
      '.nt-day.today{background-color:#EABF5C;border-color:#332F2A;box-shadow:0 0 0 2px rgba(234,191,92,.35)}',
      '.nt-day.pending{background:repeating-linear-gradient(45deg,rgba(51,47,42,.05) 0 3px,transparent 3px 6px);border-style:dashed}',
      '.nt-foot{margin-top:12px;padding-top:10px;border-top:1.5px dashed rgba(51,47,42,.22);display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:#8A8275;letter-spacing:.3px;flex-wrap:wrap}',
      '.nt-foot-actions{display:inline-flex;gap:6px;flex:0 0 auto}',
      '.nt-display{margin-top:12px;padding-top:12px;border-top:1.5px dashed rgba(51,47,42,.22)}',
      '.nt-close{flex:0 0 auto;margin-left:8px;padding:0 4px;font-family:inherit;font-size:13px;line-height:1;color:#8A8275;background:none;border:0;cursor:pointer}',
      '.nt-close:hover{color:#332F2A}',

      /* ---------- 今日时间轴（只读） ----------
         一条带刻度感的横条：实心斜纹＝工作区间，淡蓝斜纹＝午休区间，
         红针＝当前时间。节点标签只放决定阅读的三处（上班 / 午休 / 下班），
         窄屏先压掉「上班·下班」这类说明字，时间数字永远保留。 */
      '.nt-tl{margin-top:12px;padding-top:11px;border-top:1.5px dashed rgba(51,47,42,.22)}',
      '.nt-tl-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:8px}',
      '.nt-tl-title{flex:0 0 auto;font-size:11px;color:#8A8275;letter-spacing:1.6px}',
      '.nt-tl-state{flex:0 1 auto;min-width:0;font-size:11px;color:#6D6558;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.nt-tl-track{position:relative;height:12px;border:1.6px solid rgba(51,47,42,.6);border-radius:7px 9px 7px 10px/9px 7px 10px 7px;background:#FFFDF6;overflow:hidden}',
      '.nt-tl-seg{position:absolute;top:0;bottom:0}',
      '.nt-tl-seg.work{background-color:#7FA36B;background-image:repeating-linear-gradient(45deg,#7FA36B 0 5px,#96B884 5px 10px)}',
      '.nt-tl-seg.rest{background-color:rgba(76,123,140,.26);background-image:repeating-linear-gradient(45deg,rgba(76,123,140,.36) 0 4px,rgba(76,123,140,.14) 4px 8px)}',
      '.nt-tl-now{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;background:#D2605A;border-radius:1px;box-shadow:0 0 0 1.5px rgba(210,96,90,.2)}',
      '.nt-tl-labels{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-top:5px}',
      '.nt-tl-lbl{display:flex;flex-direction:column;min-width:0;font-size:10.5px;color:#8A8275}',
      '.nt-tl-lbl b{font-family:"DIN Alternate",ui-monospace,"SF Mono",Menlo,monospace;font-size:11.5px;font-weight:700;color:#4A443B;letter-spacing:0}',
      '.nt-tl-lbl i{font-style:normal;font-size:10px;color:#9A9285;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.nt-tl-lbl.mid{align-items:center;text-align:center}',
      '.nt-tl-lbl.end{align-items:flex-end;text-align:right}',
      '.nt-tl-prog{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-top:6px;font-family:"DIN Alternate",ui-monospace,"SF Mono",Menlo,monospace;font-size:11px;color:#6D6558}',
      '.nt-tl-prog>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.nt-tl-pct{flex:0 0 auto;font-weight:700;color:#4A443B}',
      '.nt-tl-known{display:flex;flex-wrap:wrap;gap:12px;font-family:"DIN Alternate",ui-monospace,"SF Mono",Menlo,monospace;font-size:11.5px;color:#4A443B}',

      /* 超时状态：持续显示，不弹窗 —— 只说「现在比计划下班时间晚了多久」 */
      '.nt-ot{display:flex;align-items:center;gap:6px;margin-top:10px;padding:5px 9px;font-size:11.5px;line-height:1.45;color:#9C3F3A;background:rgba(210,96,90,.1);border:1.3px dashed rgba(210,96,90,.45);border-radius:9px 11px 9px 12px/11px 9px 12px 9px}',
      '.nt-ot b{font-family:"DIN Alternate",ui-monospace,"SF Mono",Menlo,monospace;font-weight:700}',

      /* 下班保护设置区 */
      '.nt-note{margin:2px 0 8px;font-size:10.5px;line-height:1.55;color:#9A9285}',

      /* 提醒条：浮在胶囊上方，自带关闭按钮；三层 z-index 低于宿主自己的 dialog */
      '.nt-reminder{position:fixed;right:16px;bottom:92px;z-index:32;display:flex;align-items:center;gap:8px;max-width:320px;padding:7px 9px 8px 11px;font-family:"NT WenKai","Kaiti SC","Songti SC",system-ui,sans-serif;font-size:12.5px;line-height:1.45;color:#332F2A;background-color:rgba(255,253,246,.96);background-image:repeating-linear-gradient(to bottom,transparent 0 14px,rgba(120,170,195,.16) 14px 15px);border:1.6px solid #332F2A;border-radius:12px 15px 11px 16px/14px 11px 16px 12px;box-shadow:3px 4px 0 rgba(51,47,42,.14),0 14px 30px -14px rgba(60,45,20,.4);animation:nt-rem .18s ease-out}',
      '@keyframes nt-rem{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
      '.nt-reminder-dot{flex:0 0 auto;width:7px;height:7px;border-radius:50%;background:#D2605A}',
      '.nt-reminder-text{flex:1 1 auto;min-width:0}',
      '.nt-reminder-x{flex:0 0 auto;padding:0 3px;font-family:inherit;font-size:15px;line-height:1;color:#8A8275;background:none;border:0;cursor:pointer}',
      '.nt-reminder-x:hover{color:#332F2A}',
      '.nt-reminder-x:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2563eb);outline-offset:1px}',

      /* buttons */
      '.nt-btn{font-family:inherit;font-size:12.5px;letter-spacing:1.2px;padding:3px 13px;cursor:pointer;color:#332F2A;background:rgba(255,253,246,.7);border:1.6px solid #332F2A;border-radius:10px 13px 9px 14px/13px 9px 14px 10px;box-shadow:2px 2px 0 rgba(51,47,42,.14);transition:transform .12s ease,box-shadow .12s ease;white-space:nowrap}',
      '.nt-btn:hover{transform:translate(-1px,-1px);box-shadow:3px 3px 0 rgba(51,47,42,.16)}',
      '.nt-btn:active{transform:translate(1px,1px);box-shadow:1px 1px 0 rgba(51,47,42,.18)}',
      '.nt-btn.primary{background:#EABF5C}',

      /* form */
      '.nt-form{margin-top:12px;padding-top:12px;border-top:1.5px dashed rgba(51,47,42,.22)}',
      '.nt-field{display:flex;flex-direction:column;gap:3px;min-width:0}',
      '.nt-field label{font-size:11px;color:#6D6558;letter-spacing:1.1px}',
      '.nt-field input{width:100%;font-family:"DIN Alternate",ui-monospace,"SF Mono",Menlo,monospace;font-size:13px;color:#332F2A;background:rgba(255,253,246,.9);border:1.4px solid rgba(51,47,42,.5);border-radius:7px 9px 7px 10px/9px 7px 10px 7px;padding:4px 8px;outline:none}',
      '.nt-field input:focus{border-color:#4C7B8C;box-shadow:0 0 0 2.5px rgba(76,123,140,.14)}',
      '.nt-row{display:grid;grid-template-columns:1fr;gap:8px;margin-bottom:8px}',
      '.nt-row2{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}',
      '.nt-hint{font-size:10.5px;color:#9A9285}',
      '.nt-err{min-height:15px;font-size:11.5px;color:#D2605A;letter-spacing:.5px;margin-bottom:4px}',
      '.nt-actions{display:flex;gap:8px;justify-content:flex-end}',

      '@media (prefers-color-scheme: dark){.nt-chip{box-shadow:2px 2px 0 rgba(0,0,0,.4)}}',
      /* 窄屏：浮层铺满可用宽度，跟着视口走，不再对齐胶囊 */
      '@media (max-width:620px){.nt-panel{left:12px;right:12px;width:auto;max-width:none}.nt-layer{padding:12px}.nt-pointer{display:none}}',
      '@media (max-width:520px){.nt-panel{padding:13px 12px 11px}.nt-amount .val{font-size:28px}.nt-row2{grid-template-columns:1fr 1fr}}',
      /* 窄屏只在真的放不下时才降级，按重要性从低到高丢：
         ① ≤560px 收紧间距与进度条宽度；② ≤430px 收起本月累计；
         ③ ≤340px 收起完整模式的进度小段；④ ≤260px 只剩金额与标签。 */
      '@media (max-width:560px){.nt-chip{gap:6px}.nt-chip--full,.nt-chip--fun,.nt-chip--mini{min-width:0;max-width:100%}.nt-chip--fun .nt-chip-val,.nt-chip--fun .nt-progress-lead{font-size:14px}.nt-chip--full .nt-full-note{display:none}.nt-chip--full .nt-full-track{width:32px}}',
      '@media (max-width:430px){.nt-money.nt-chip-sub{display:none}}',
      '@media (max-width:340px){.nt-chip--full .nt-full-prog{display:none}.nt-chip--fun .nt-fun-badge{font-size:10px;padding:0 6px;max-width:9em;overflow:hidden;text-overflow:ellipsis}}',
      /* 趣味模式的倒计时徽章文字最长，窄屏让它先缩，不要把整条胶囊撑爆 */
      '@media (max-width:420px){.nt-chip--fun .nt-fun-badge{max-width:7.5em;overflow:hidden;text-overflow:ellipsis;min-width:0}.nt-chip--fun .nt-chip-val,.nt-chip--fun .nt-progress-lead{font-size:13px}}',
      '@media (max-width:260px){.nt-chip--full .nt-full-badge{display:none}.nt-chip--fun .nt-fun-badge{display:none}.nt-chip--mini .nt-mini-track{display:none}}',

      /* 时间轴与提醒条的窄屏降级（必须排在所有基础规则之后，否则会被覆盖）：
         ≤520px 提醒条铺满宽度；≤440px 先压掉「上班 / 午休 / 下班」这类说明字，
         节点时间与当前状态仍然保留 —— 这两样是可辨识性的下限，不参与降级。 */
      '@media (max-width:520px){.nt-reminder{left:12px;right:12px;max-width:none}}',
      '@media (max-width:440px){.nt-tl-lbl i{display:none}.nt-tl-lbl b{font-size:11px}.nt-tl-prog{font-size:10.5px}}',
      '@media (max-width:300px){.nt-tl-prog>span:first-child{white-space:normal}.nt-tl-known{gap:8px}}',
      '@media (prefers-reduced-motion:reduce){.nt-reminder{animation:none}}'
    ].join('\n')
    // ---------- components ----------
    function Day(props) {
      return h('span', { className: 'nt-day ' + props.kind })
    }

    function Settings(props) {
      var T = props.T
      var cfg = props.cfg
      var st = React.useState(function () {
        return {
          salary: String(cfg.salary),
          start: cfg.start,
          end: cfg.end,
          breakStart: cfg.breakStart,
          breakMin: String(cfg.breakMin),
          workdays: String(cfg.workdays)
        }
      })
      var draft = st[0]
      var setDraft = st[1]
      var err = React.useState('')
      var errMsg = err[0]
      var setErr = err[1]
      var saved = React.useState(false)
      var isSaved = saved[0]
      var setIsSaved = saved[1]

      function patch(key, value) {
        setDraft(function (prev) {
          var next = {}
          for (var k in prev) { next[k] = prev[k] }
          next[key] = value
          return next
        })
        setErr('')
        setIsSaved(false)
      }

      function submit() {
        var salary = Number(draft.salary)
        var workdays = Number(draft.workdays)
        if (!(salary > 0)) { setErr(T('errSalary')); return }
        if (!validTime(draft.start) || !validTime(draft.end)) { setErr(T('errTime')); return }
        if (toSec(draft.end) <= toSec(draft.start)) { setErr(T('errOrder')); return }
        if (toSec(draft.breakStart) < toSec(draft.start) || toSec(draft.breakStart) > toSec(draft.end)) {
          setErr(T('errBreak')); return
        }
        if (!isFinite(workdays) || workdays < 0 || workdays > 31) { setErr(T('errDays')); return }
        var net = (toSec(draft.end) - toSec(draft.start)) - Math.max(0, Number(draft.breakMin) || 0) * 60
        if (net <= 0) { setErr(T('errNet')); return }

        props.onSave({
          salary: salary,
          start: draft.start,
          end: draft.end,
          breakStart: draft.breakStart,
          breakMin: Math.max(0, Number(draft.breakMin) || 0),
          workdays: Math.round(workdays)
        })
        setIsSaved(true)
      }

      function field(key, label, type, extra) {
        return h('div', { className: 'nt-field' },
          h('label', null, label),
          h('input', {
            type: type,
            value: draft[key],
            step: extra && extra.step,
            min: extra && extra.min,
            max: extra && extra.max,
            onChange: function (e) { patch(key, e.target.value) }
          })
        )
      }

      return h('div', { className: 'nt-form' },
        h('div', { className: 'nt-row' }, field('salary', T('salaryLabel'), 'number', { step: 100, min: 1 })),
        h('div', { className: 'nt-row2' },
          field('start', T('startLabel'), 'time'),
          field('end', T('endLabel'), 'time')),
        h('div', { className: 'nt-row2' },
          field('breakStart', T('breakStartLabel'), 'time'),
          field('breakMin', T('breakMinLabel'), 'number', { step: 5, min: 0 })),
        h('div', { className: 'nt-row' },
          field('workdays', T('workdaysLabel'), 'number', { step: 1, min: 0, max: 31 }),
          h('span', { className: 'nt-hint' }, T('workdaysHint', { n: autoWorkdays(new Date()) }))),
        h('div', { className: 'nt-err' }, errMsg),
        h('div', { className: 'nt-actions' },
          isSaved ? h('span', { className: 'nt-hint', style: { alignSelf: 'center', marginRight: 'auto' } }, T('saved')) : null,
          h('button', { className: 'nt-btn primary', type: 'button', onClick: submit }, T('save')))
      )
    }

    // ---------- display settings ----------
    // 「显示方案 / 字段 / 密度 / 位置 / 隐藏」都在这一块里改，改完立即生效并落盘。
    function Seg(props) {
      var T = props.T
      var options = props.options   // [[value, labelKey], ...]
      var value = props.value
      return h('div', { className: 'nt-seg', role: 'group', 'aria-label': props.label },
        options.map(function (pair) {
          var v = pair[0]
          var on = v === value
          return h('button', {
            key: v,
            type: 'button',
            'aria-pressed': on,
            onClick: function () { props.onChange(v) }
          }, T(pair[1]))
        })
      )
    }

    function DisplaySettings(props) {
      var T = props.T
      var cfg = props.cfg
      var onChange = props.onChange

      var modes = [['mini', 'modeMini'], ['full', 'modeFull'], ['fun', 'modeFun']]
      var modeHints = { mini: 'modeMiniHint', full: 'modeFullHint', fun: 'modeFunHint' }
      var fields = [['amount', 'fieldAmount'], ['progress', 'fieldProgress'], ['month', 'fieldMonth'],
        ['status', 'fieldStatus'], ['remain', 'fieldRemain'], ['rate', 'fieldRate']]

      function toggleField(id) {
        var patch = { fields: {} }
        patch.fields[id] = !cfg.fields[id]
        onChange(patch)
      }

      function fieldOn(id) { return cfg.fields[id] === true }

      return h('div', { className: 'nt-display' },
        h('span', { className: 'nt-dot-title', style: { margin: '0 0 6px' } }, T('mode')),
        h('div', { className: 'nt-modes' },
          modes.map(function (pair) {
            var on = cfg.mode === pair[0]
            return h('button', {
              key: pair[0],
              type: 'button',
              'aria-pressed': on,
              onClick: function () { onChange({ mode: pair[0] }) }
            }, T(pair[1]))
          })
        ),
        h('p', { className: 'nt-modehint' }, T(modeHints[cfg.mode] || 'modeFullHint')),

        h('div', { className: 'nt-rowseg' },
          h('label', null, T('densityLabel')),
          h(Seg, {
            T: T,
            label: T('densityLabel'),
            value: cfg.density,
            options: [['compact', 'densityCompact'], ['cozy', 'densityCozy']],
            onChange: function (v) { onChange({ density: v }) }
          })
        ),
        h('div', { className: 'nt-rowseg' },
          h('label', null, T('placeLabel')),
          h(Seg, {
            T: T,
            label: T('placeLabel'),
            value: cfg.place,
            options: [['left', 'placeLeft'], ['center', 'placeCenter'], ['right', 'placeRight']],
            onChange: function (v) { onChange({ place: v }) }
          })
        ),

        h('span', { className: 'nt-dot-title', style: { margin: '10px 0 6px' } }, T('fieldsLabel')),
        h('div', { className: 'nt-checks' },
          fields.map(function (pair) {
            var id = pair[0]
            return h('label', { key: id, className: 'nt-check' },
              h('input', {
                type: 'checkbox',
                checked: fieldOn(id),
                onChange: function () { toggleField(id) }
              }),
              h('span', null, T(pair[1]))
            )
          })
        ),

        h('label', { className: 'nt-switch' },
          h('input', {
            type: 'checkbox',
            checked: cfg.hideMoney === true,
            onChange: function () { onChange({ hideMoney: !cfg.hideMoney }) }
          }),
          h('span', null, T('hideMoneyLabel'))
        ),
        h('label', { className: 'nt-switch' },
          h('input', {
            type: 'checkbox',
            checked: false,
            onChange: function () { onChange({ hidden: true }) }
          }),
          h('span', null, T('hideChipLabel'))
        ),
        h('p', { className: 'nt-hint', style: { margin: '-2px 0 0' } }, T('hideChipHint'))
      )
    }

    // ---------- 今日时间轴（只读视图，没有任何可点元素） ----------
    function Timeline(props) {
      var T = props.T
      var cfg = props.cfg
      var tl = props.tl

      var stateTxt = ''
      if (tl.ordered) {
        if (props.rest) { stateTxt = T('stRest') }
        else if (tl.phase === 'before') { stateTxt = T('tlBefore') }
        else if (tl.phase === 'after') { stateTxt = T('tlAfter') }
        else if (props.status === 'break') { stateTxt = T('stBreak') }
        else { stateTxt = T('stWorking') }
      }

      var head = h('div', { className: 'nt-tl-head' },
        h('span', { className: 'nt-tl-title' }, T('tlTitle')),
        h('span', { className: 'nt-tl-state' }, tl.ordered ? stateTxt : T('tlNoSchedule'))
      )

      // 时间配不全：只列已知节点。没有量程就不画刻度、不算百分比——
      // 假的 0% / 负时长 / 错倒计时比空白更糟。
      if (!tl.ordered) {
        var known = []
        if (tl.hasStart) { known.push(h('span', { key: 's' }, T('tlStart') + ' ' + cfg.start)) }
        if (tl.hasEnd) { known.push(h('span', { key: 'e' }, T('tlEnd') + ' ' + cfg.end)) }
        return h('div', { className: 'nt-tl' }, head,
          known.length
            ? h('div', { className: 'nt-tl-known' }, known)
            : h('p', { className: 'nt-note', style: { margin: '0' } }, T('tlNeedTimes'))
        )
      }

      var span = tl.endSec - tl.startSec
      var segs = []
      if (tl.hasBreak) {
        var b0 = (tl.bsSec - tl.startSec) / span
        var b1 = (tl.beSec - tl.startSec) / span
        if (b0 > 0) {
          segs.push(h('span', { key: 'w1', className: 'nt-tl-seg work', style: { left: '0%', width: (b0 * 100).toFixed(2) + '%' } }))
        }
        segs.push(h('span', { key: 'br', className: 'nt-tl-seg rest', style: { left: (b0 * 100).toFixed(2) + '%', width: ((b1 - b0) * 100).toFixed(2) + '%' } }))
        if (b1 < 1) {
          segs.push(h('span', { key: 'w2', className: 'nt-tl-seg work', style: { left: (b1 * 100).toFixed(2) + '%', width: ((1 - b1) * 100).toFixed(2) + '%' } }))
        }
      } else {
        segs.push(h('span', { key: 'w', className: 'nt-tl-seg work', style: { left: '0%', width: '100%' } }))
      }
      segs.push(h('span', { key: 'now', className: 'nt-tl-now', style: { left: (tl.nowPct * 100).toFixed(2) + '%' } }))

      var breakTxt = cfg.breakStart + '–' + hmTxt(tl.beSec)
      var labels = [
        h('span', { key: 's', className: 'nt-tl-lbl' },
          h('b', null, cfg.start), h('i', null, T('tlStart'))),
        tl.hasBreak
          ? h('span', { key: 'b', className: 'nt-tl-lbl mid' },
            h('b', null, breakTxt), h('i', null, T('tlBreak')))
          : null,
        h('span', { key: 'e', className: 'nt-tl-lbl end' },
          h('b', null, cfg.end), h('i', null, T('tlEnd')))
      ]

      var prog = (tl.planned && tl.planned > 0)
        ? h('div', { className: 'nt-tl-prog' },
          h('span', null, T('tlProgress', { a: durTxt(tl.worked, T), b: durTxt(tl.planned, T) })),
          h('span', { className: 'nt-tl-pct' }, Math.round(tl.ratio * 100) + '%'))
        : null

      var ariaParts = [T('tlStart') + ' ' + cfg.start]
      if (tl.hasBreak) { ariaParts.push(T('tlBreak') + ' ' + breakTxt) }
      ariaParts.push(T('tlEnd') + ' ' + cfg.end)

      return h('div', { className: 'nt-tl' },
        head,
        h('div', {
          className: 'nt-tl-track',
          role: 'img',
          'aria-label': ariaParts.join(' · ')
        }, segs),
        h('div', { className: 'nt-tl-labels' }, labels),
        prog
      )
    }

    // ---------- 下班保护设置 ----------
    // 三项独立开关，默认全关；这里只改提醒策略，不碰排班与收入。
    function NotifySettings(props) {
      var T = props.T
      var notify = props.cfg.notify

      function patch(part) { props.onChange({ notify: part }) }
      function toggle(key) {
        var p = {}
        p[key] = !(notify[key] === true)
        patch(p)
      }

      return h('div', { className: 'nt-display' },
        h('span', { className: 'nt-dot-title', style: { margin: '0 0 2px' } }, T('notifyTitle')),
        h('p', { className: 'nt-note' }, T('notifyLead')),

        h('label', { className: 'nt-switch' },
          h('input', {
            type: 'checkbox',
            checked: notify.preEnd === true,
            onChange: function () { toggle('preEnd') }
          }),
          h('span', null, T('preEndLabel'))
        ),
        h('div', { className: 'nt-rowseg' },
          h('label', null, T('leadLabel')),
          h(Seg, {
            T: T,
            label: T('leadLabel'),
            value: String(notify.lead),
            options: [['5', 'lead5'], ['10', 'lead10'], ['15', 'lead15'], ['30', 'lead30']],
            onChange: function (v) { patch({ lead: Number(v) }) }
          })
        ),
        h('label', { className: 'nt-switch' },
          h('input', {
            type: 'checkbox',
            checked: notify.atEnd === true,
            onChange: function () { toggle('atEnd') }
          }),
          h('span', null, T('atEndLabel'))
        ),
        h('label', { className: 'nt-switch' },
          h('input', {
            type: 'checkbox',
            checked: notify.overtime === true,
            onChange: function () { toggle('overtime') }
          }),
          h('span', null, T('overtimeLabel'))
        ),
        h('p', { className: 'nt-note' }, T('overtimeHint')),
        h('p', { className: 'nt-note', style: { marginBottom: '0' } }, T('notifyNote'))
      )
    }

    // ---------- 提醒条 ----------
    // 内嵌提示是主路径：不申请任何权限，也不会因为权限被拒而消失。
    // 若浏览器**已经**授予通知权限，则额外发一条系统通知（本插件从不主动申请）。
    function Reminder(props) {
      var node = h('div', { className: 'nt-reminder', role: 'status', 'aria-live': 'polite' },
        h('span', { className: 'nt-reminder-dot' }),
        h('span', { className: 'nt-reminder-text' }, props.text),
        h('button', {
          className: 'nt-reminder-x',
          type: 'button',
          title: props.T('close'),
          'aria-label': props.T('close'),
          onClick: props.onClose
        }, '×')
      )
      if (ReactDOM) { return ReactDOM.createPortal(node, document.body) }
      return node
    }

    /** 只在浏览器**已经**授予通知权限时发系统通知；从不主动申请，被拒也不重试。 */
    function systemNotify(title, body) {
      try {
        if (typeof Notification === 'undefined') { return }
        if (Notification.permission !== 'granted') { return }
        var n = new Notification(title, { body: body, tag: 'dsh-niuma-timer' })
        if (n && typeof n.close === 'function') { setTimeout(function () { try { n.close() } catch (e) { /* ignore */ } }, 8000) }
      } catch (e) { /* 通知不可用就只留内嵌提示 */ }
    }

    // ---------- floating panel plumbing ----------
    // 浮层的位置全部由「底部胶囊」的实时测量结果推导：
    //   --nt-left   卡片左边（等于胶囊左沿，clamp 进视口）
    //   --nt-width  卡片宽度（跟随胶囊，上限 560px / 视口宽）
    //   --nt-top    胶囊上沿在视口中的 y，卡片 bottom 就贴到这里
    //   --nt-max-h  卡片最多能长多高（到视口顶部留 10px 为止）
    //   --nt-pointer 小尾巴相对卡片左沿的位置（对准胶囊中线）
    // 只写 CSS 变量，不写任何布局属性，所以 dock / 输入框 / 对话列都不会被撑开。
    var PANEL_MAX_W = 560
    var LAYER_PAD = 12
    var TOP_GAP = 10

    function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n) }

    function measure(anchor) {
      var out = { left: '0px', width: PANEL_MAX_W + 'px', top: '0px', 'max-h': '72vh', pointer: '50%' }
      if (!anchor || typeof window === 'undefined') { return out }
      var box = anchor.getBoundingClientRect()
      var vw = window.innerWidth || document.documentElement.clientWidth || 0
      if (!vw) { return out }
      var narrow = vw <= 620
      var width = narrow ? (vw - LAYER_PAD * 2) : clamp(Math.min(Math.max(box.width, 400), PANEL_MAX_W, vw - LAYER_PAD * 2), 280, PANEL_MAX_W)
      var left = narrow ? LAYER_PAD : clamp(box.left + (box.width - width) / 2, LAYER_PAD, Math.max(LAYER_PAD, vw - width - LAYER_PAD))
      var top = Math.max(box.top - 8, 40)
      out.left = Math.round(left) + 'px'
      out.width = Math.round(width) + 'px'
      out.top = Math.round(top) + 'px'
      out['max-h'] = Math.max(160, Math.round(top - TOP_GAP)) + 'px'
      out.pointer = Math.round(clamp(box.left + box.width / 2 - left, 22, width - 22)) + 'px'
      return out
    }

    function FloatingPanel(props) {
      var anchor = props.anchor
      var onClose = props.onClose
      var card = React.useRef(null)
      var pos = React.useState(function () { return measure(anchor) })
      var setPos = pos[1]

      React.useLayoutEffect(function () {
        function remeasure() { setPos(measure(anchor)) }
        remeasure()
        window.addEventListener('resize', remeasure)
        window.addEventListener('scroll', remeasure, true)
        return function () {
          window.removeEventListener('resize', remeasure)
          window.removeEventListener('scroll', remeasure, true)
        }
      }, [])

      React.useEffect(function () {
        function onKey(e) { if (e.key === 'Escape') { onClose() } }
        function onDown(e) {
          var node = card.current
          if (node && e.target instanceof Node && node.contains(e.target)) { return }
          if (anchor && e.target instanceof Node && anchor.contains(e.target)) { return }
          onClose()
        }
        document.addEventListener('keydown', onKey)
        document.addEventListener('mousedown', onDown, true)
        return function () {
          document.removeEventListener('keydown', onKey)
          document.removeEventListener('mousedown', onDown, true)
        }
      }, [anchor, onClose])

      var style = {
        '--nt-left': pos[0].left,
        '--nt-width': pos[0].width,
        '--nt-top': pos[0].top,
        '--nt-max-h': pos[0]['max-h'],
        '--nt-pointer': pos[0].pointer
      }

      var layer = h('div', { className: 'nt-layer' },
        h('div', {
          className: 'nt-panel',
          ref: card,
          style: style,
          role: 'dialog',
          'aria-label': props.label
        }, props.children, h('div', { className: 'nt-pointer' }))
      )

      if (ReactDOM) { return ReactDOM.createPortal(layer, document.body) }
      return layer
    }

    function NiumaTimer() {
      var cfgState = React.useState(readCfg)
      var cfg = cfgState[0]
      var setCfg = cfgState[1]
      var openState = React.useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      var formState = React.useState(false)
      var showForm = formState[0]
      var setShowForm = formState[1]
      var displayState = React.useState(false)
      var showDisplay = displayState[0]
      var setShowDisplay = displayState[1]
      var notifyState = React.useState(false)
      var showNotify = notifyState[0]
      var setShowNotify = notifyState[1]
      var firedState = React.useState(readFired)
      var fired = firedState[0]
      var setFired = firedState[1]
      var bannerState = React.useState(null)
      var banner = bannerState[0]
      var setBanner = bannerState[1]
      var tickState = React.useState(function () { return Date.now() })
      var tick = tickState[0]
      var setTick = tickState[1]
      var chipRef = React.useRef(null)

      React.useEffect(function () {
        var timer = setInterval(function () { setTick(Date.now()) }, 500)
        return function () { clearInterval(timer) }
      }, [])

      var locale = readLocale()
      var T = function (key, vars) { return tr(locale, key, vars) }

      var now = new Date(tick)
      var r = compute(cfg, now)
      var tl = timelineOf(cfg, now)
      var statusKey = !tl.ordered ? 'tlNoSchedule' : r.status === 'working' ? 'stWorking'
        : r.status === 'break' ? 'stBreak'
          : r.status === 'off' ? 'stOff'
            : r.status === 'overtime' ? 'stOvertime'
              : r.status === 'idle' ? 'stIdle' : 'stRest'
      var stampClass = 'nt-stamp' + (!tl.ordered ? ' grey' : r.status === 'break' ? ' blue' : r.status === 'off' ? ' green'
        : (r.status === 'idle' || r.status === 'rest') ? ' grey' : '')

      var subLine
      if (!tl.ordered) { subLine = T('tlNeedTimes') }
      else if (r.status === 'rest') { subLine = T('restLine') }
      else if (r.status === 'idle') { subLine = T('idleLine', { t: cfg.start }) }
      else if (r.status === 'overtime') { subLine = T('otLine', { a: money(r.dayPay), b: durTxt(r.overtime, T) }) }
      else if (r.status === 'off') { subLine = T('offLine', { v: money(r.dayPay) }) }
      else { subLine = T('workedLine', { a: durTxt(r.worked, T), b: durTxt(r.remain, T) }) }

      var capped = r.status === 'off' || r.status === 'overtime' || r.status === 'rest'
      var monthRatio = r.salary > 0 ? r.monthEarn / r.salary : 0

      // 超时状态：持续显示的一行，不是弹窗，也不参与任何收入计算。
      var otOn = cfg.notify.overtime === true
      var otMins = Math.floor(r.overtime / 60)
      var otLine = (otOn && r.status === 'overtime' && r.overtime > 0)
        ? h('div', { className: 'nt-ot' },
          h('span', null, otMins < 1 ? T('otJustNow') : T('otOvertime', { n: otMins })))
        : null

      // 下班保护：跟着 500ms 的 tick 判断一次。命中就写进「今天已响」账本，
      // 同一类型同一自然日只响一次；休息日、时间不全、开关关着都不触发。
      React.useEffect(function () {
        if (r.status === 'rest') { return }
        if (!validTime(cfg.start) || !validTime(cfg.end)) { return }
        var endSec = toSec(cfg.end)
        if (!(endSec > toSec(cfg.start))) { return }
        var n = cfg.notify
        if (n.preEnd !== true && n.atEnd !== true) { return }

        var nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
        var today = dayKey(now)
        var base = fired.day === today ? fired : { day: today, preEnd: false, atEnd: false }
        var hit = null

        if (n.preEnd === true && base.preEnd !== true) {
          var lead = oneOf(Number(n.lead), LEADS, 10) * 60
          if (nowSec >= endSec - lead && nowSec < endSec) {
            hit = { kind: 'preEnd', text: T('remPreEnd', { t: durTxt(endSec - nowSec, T) }) }
          }
        }
        if (!hit && n.atEnd === true && base.atEnd !== true) {
          // 到点后 1 小时内补发一次；再晚就不补，免得半夜弹出一条陈年提醒。
          if (nowSec >= endSec && nowSec - endSec <= 3600) {
            hit = { kind: 'atEnd', text: T('remAtEnd', { t: cfg.end }) }
          }
        }
        if (!hit) { return }

        var nextFired = {
          day: today,
          preEnd: base.preEnd === true || hit.kind === 'preEnd',
          atEnd: base.atEnd === true || hit.kind === 'atEnd'
        }
        writeFired(nextFired)
        setFired(nextFired)
        setBanner(hit)
        systemNotify(T('title'), hit.text)
      }, [tick, fired, r.status])

      var dots = []
      var dayCount = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
      for (var d = 1; d <= dayCount; d++) {
        var date = new Date(now.getFullYear(), now.getMonth(), d)
        if (isWeekend(date)) { continue }
        var kind = d < now.getDate() ? 'done' : (d === now.getDate() ? 'today' : 'pending')
        dots.push(h(Day, { key: d, kind: kind }))
      }

      function toggle() { setOpen(!open) }
      function close() { setOpen(false) }

      function onKeyDown(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          toggle()
        }
      }

      // 三种显示方案各自渲染，共用同一个 chip 外壳（点击/键盘/aria 一致）。
      var pct = Math.round(clamp(r.progress, 0, 1) * 100)
      var pctText = pct + '%'
      var moneyHidden = cfg.hideMoney === true
      var show = cfg.fields
      var badgeClass = r.status === 'working' ? '' : (r.status === 'break' ? 'red' : 'grey')
      var remainTxt = durTxt(r.remain, T)
      var doneish = r.status === 'off' || r.status === 'overtime' || r.status === 'rest'

      // 隐藏金额时，金额原本的位置交给进度百分比——「只显示工作进度」要真的看得见进度，
      // 而不是留一块空白；aria-label 同样不该再把金额念出来。
      var amountNode = show.amount && !moneyHidden
        ? h('span', { key: 'amount', className: 'nt-money nt-chip-val' }, '¥' + money(r.todayEarn))
        : null
      var monthNode = show.month && !moneyHidden
        ? h('span', { key: 'month', className: 'nt-chip-sub nt-money' }, T('chipMonth', { v: money(r.monthEarn) }))
        : null
      var progressNode = show.progress
        ? h('span', { key: 'progress', className: 'nt-chip-sub' }, T('chipToday', { p: pct }))
        : null
      var primaryNode = amountNode || h('span', { key: 'lead', className: 'nt-chip-val nt-progress-lead' }, pctText)

      var chipInner

      if (cfg.mode === 'mini') {
        // A · 极简：`● 今日已赚 ¥398.55 ▬▬▬ 70%`
        chipInner = [
          h('span', { key: 'main', className: 'nt-mini-main' },
            h('span', { className: 'nt-dot' + (r.status === 'working' ? ' live' : ' idle') }),
            h('span', { className: 'nt-chip-sub' }, T('miniToday')),
            amountNode
          ),
          h('span', { key: 'track', className: 'nt-mini-track' },
            h('span', { className: 'nt-mini-fill', style: { width: pct + '%' } })),
          h('span', { key: 'pct', className: 'nt-mini-pct' }, pctText),
          h('span', { key: 'caret', className: 'nt-caret' }, open ? '▲' : '▼')
        ]
      } else if (cfg.mode === 'fun') {
        // C · 趣味（单行）：`🐮 今日打工收益 ¥398.55 [距离解放还有 2 小时] ▼`
        chipInner = [
          h('span', { key: 'label', className: 'nt-fun-label' }, '🐮 ', T('funLabel')),
          primaryNode,
          show.remain
            ? h('span', {
              key: 'badge',
              className: 'nt-fun-badge' + (doneish ? ' grey' : ''),
              // 悬停/读屏保留原来那两句状态文案
              title: doneish ? T('funFrozen') : T('funTicking')
            },
            r.status === 'overtime'
              ? T('remainBadgeOt', { t: durTxt(r.overtime, T) })
              : T(doneish ? 'remainBadgeDone' : 'remainBadge', { t: remainTxt }))
            : null,
          h('span', { key: 'caret', className: 'nt-caret' }, open ? '▲' : '▼')
        ]
      } else {
        // B · 完整（单行）：`● 牛马费 ¥398.55 [打工中] ▬▬ 82% · 本月 ¥6,174 ▼`
        // 进度用一小段进度条 + 百分比表达，不再单独占一行。
        chipInner = [
          h('span', { key: 'main', className: 'nt-full-main' },
            h('span', { className: 'nt-dot' + (r.status === 'working' ? ' live' : ' idle') }),
            h('span', { className: 'nt-chip-sub' }, T('chipLabel')),
            primaryNode
          ),
          show.status
            ? h('span', { key: 'badge', className: 'nt-full-badge ' + badgeClass },
              (otOn && r.status === 'overtime')
                ? T('otBadge', { n: Math.max(1, otMins) })
                : T(statusKey))
            : null,
          (show.progress && !moneyHidden && amountNode)
            ? h('span', { key: 'prog', className: 'nt-full-prog' },
              h('span', { className: 'nt-full-track' },
                h('span', { className: 'nt-full-fill', style: { width: pct + '%' } })),
              h('span', { className: 'nt-full-note' }, pctText))
            : null,
          monthNode,
          h('span', { key: 'caret', className: 'nt-caret' }, open ? '▲' : '▼')
        ]
      }

      var chip = h('div', {
        className: 'nt-chip nt-chip--' + cfg.mode,
        ref: chipRef,
        role: 'button',
        tabIndex: 0,
        'aria-expanded': open,
        'aria-label': T('title') + ' ' + (moneyHidden ? pctText : ('¥' + money(r.todayEarn) + ' ' + pctText)),
        'data-hide-money': moneyHidden ? 'true' : 'false',
        'data-density': cfg.density,
        title: T('title') + (moneyHidden ? ' · ' + T('moneyHidden') : ''),
        onClick: toggle,
        onKeyDown: onKeyDown
      }, chipInner)

      var body = !open ? null : h(FloatingPanel, { anchor: chipRef.current, onClose: close, label: T('title') },
        h('div', { className: 'nt-tape' }),
        h('div', { className: 'nt-body' },
          h('div', { className: 'nt-head' },
            h('span', { className: 'nt-title' }, T('title')),
            h('span', { className: stampClass }, T(statusKey))
          ),
          h('div', { className: 'nt-amount' },
            h('span', { className: 'cur' }, '¥'),
            h('span', { className: 'val' }, money(r.todayEarn))
          ),
          tl.ordered ? h('div', { className: 'nt-rate' }, capped ? T('capped') : T('perSec', { v: r.secPay.toFixed(4) })) : null,
          h('div', { className: 'nt-sub' }, subLine),

          tl.ordered ? h('div', { className: 'nt-bar' },
            h('div', { className: 'nt-fill', style: { width: Math.round(Math.min(1, r.progress) * 100) + '%' } })) : null,
          tl.ordered ? h('div', { className: 'nt-barnote' },
            h('span', null, T('progress', { p: (r.progress * 100).toFixed(1) })),
            h('span', null, (r.status === 'off' || r.status === 'overtime' || r.status === 'rest') ? T('finished') : T('remain', { t: clockTxt(r.remain) }))
          ) : null,

          h(Timeline, { T: T, cfg: cfg, tl: tl, rest: r.status === 'rest', status: r.status }),
          otLine,

          h('div', { className: 'nt-meta' },
            h('div', { className: 'cell' },
              h('span', { className: 'k' }, T('dayPay')),
              h('span', { className: 'v' }, '¥' + money(r.dayPay))),
            h('div', { className: 'cell' },
              h('span', { className: 'k' }, T('hourPay')),
              h('span', { className: 'v' }, '¥' + r.hourPay.toFixed(1))),
            h('div', { className: 'cell' },
              h('span', { className: 'k' }, T('secPay')),
              h('span', { className: 'v' }, '¥' + r.secPay.toFixed(4)))
          ),

          h('span', { className: 'nt-dot-title' }, T('dots')),
          h('div', { className: 'nt-dots' }, dots),

          h('div', { className: 'nt-foot' },
            h('span', null, T('monthTotal') + ' ¥' + money(r.monthEarn) + ' · ' + T('monthRatio', { p: (monthRatio * 100).toFixed(1) })),
            h('span', { className: 'nt-foot-actions' },
              h('button', {
                className: 'nt-btn' + (showDisplay && !showForm ? ' primary' : ''),
                type: 'button',
                onClick: function () {
                  setShowForm(false)
                  setShowNotify(false)
                  setShowDisplay(!(showDisplay && !showForm))
                }
              }, T('displayTitle')),
              h('button', {
                className: 'nt-btn' + (showNotify ? ' primary' : ''),
                type: 'button',
                onClick: function () {
                  setShowForm(false)
                  setShowDisplay(false)
                  setShowNotify(!showNotify)
                }
              }, T('notifyTitle')),
              h('button', {
                className: 'nt-btn' + (showForm ? ' primary' : ''),
                type: 'button',
                onClick: function () {
                  setShowDisplay(false)
                  setShowNotify(false)
                  setShowForm(!showForm)
                }
              }, showForm ? T('close') : T('edit'))
            )
          ),

          showForm ? h(Settings, {
            cfg: cfg,
            T: T,
            onSave: function (next) {
              var merged = mergeCfg(cfg, next)
              setCfg(merged)
              writeCfg(merged)
            }
          }) : null,

          (showDisplay && !showForm && !showNotify) ? h(DisplaySettings, {
            cfg: cfg,
            T: T,
            onChange: function (patch) {
              var merged = mergeCfg(cfg, patch)
              setCfg(merged)
              writeCfg(merged)
              if (patch.hidden) { setOpen(false) }
            }
          }) : null,

          (showNotify && !showForm && !showDisplay) ? h(NotifySettings, {
            cfg: cfg,
            T: T,
            onChange: function (patch) {
              var merged = mergeCfg(cfg, patch)
              setCfg(merged)
              writeCfg(merged)
            }
          }) : null
        )
      )

      // 提醒条：独立浮层，胶囊隐藏时也照常出现（否则「下班保护」会被胶囊一起关掉）。
      var reminder = banner
        ? h(Reminder, { T: T, text: banner.text, onClose: function () { setBanner(null) } })
        : null

      // 一键隐藏：胶囊整体不渲染，只在右下角留一个极小圆点把它们叫回来。
      if (cfg.hidden) {
        return h(React.Fragment, null,
          h('button', {
            className: 'nt-dot-restore',
            type: 'button',
            title: T('showChip'),
            'aria-label': T('showChip'),
            onClick: function () {
              var merged = mergeCfg(cfg, { hidden: false })
              setCfg(merged)
              writeCfg(merged)
            }
          }, '🐮'),
          reminder
        )
      }

      return h('div', { className: 'nt-wrap', 'data-place': cfg.place }, chip, body, reminder)
    }

    // ---------- plugin ----------
    return {
      inject: ['slots'],
      apply(ctx) {
        hostCtx = ctx

        var install = function () {
          if (typeof document === 'undefined') { return function () {} }
          var el = document.createElement('style')
          el.setAttribute('data-dsh-niuma-timer', '')
          el.textContent = CSS
          document.head.appendChild(el)
          return function () { el.remove() }
        }
        if (typeof ctx.effect === 'function') { ctx.effect(install) } else { install() }

        ctx.slots.inject('conversation.composer.dock', function () {
          return ctx.slots.register({
            name: 'conversation.composer.dock',
            id: 'niuma-timer',
            order: 60
          }, NiumaTimer)
        })
      }
    }
  }
})
