/* MOONone お客様側の予約機能
   個人キャストページに「ご予約」欄を追加します(index.html には読み込みの1行だけ足す)。
   流れ: 日付・コース・時間を選ぶ → 30分の仮押さえを作る → 予約内容が入ったSMSを開く
   必要なもの: moonone_hold.sql を実行済みであること(public_busy と create_hold) */
(function () {
  'use strict';
  var CFG = window.MOON_CONFIG || {};
  if (!CFG.url || !CFG.anon) return;

  // ▼ 設定(変えるときはここだけ)
  var SMS_TO = '07055755034';   // SMS送信先 070-5575-5034
  var LEAD_MIN = 30;            // 現在時刻からこの分数より先の時間だけ選べる
  var BUFFER = 15;              // 予約と予約の間隔(分)
  var COURSES = [[60, 16000], [70, 18000], [90, 22000], [120, 27000], [150, 32000]]; // [分, 料金] ※料金表と同じ値

  var W = '日月火水木金土';
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var yen = function (n) { return n.toLocaleString('ja-JP') + '円'; };
  var mins = function (t) { var m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : 0; };
  var hm = function (n) { n = ((n % 1440) + 1440) % 1440; return pad(Math.floor(n / 60)) + ':' + pad(n % 60); };
  var ymd = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var jstNow = function () { return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })); };
  var isIOS = function () { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); };

  function get(path) {
    return fetch(CFG.url + '/rest/v1/' + path, { headers: { apikey: CFG.anon } }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }

  var st = document.createElement('style');
  st.textContent = '#moon-reserve{margin-top:8px}#moon-reserve label{display:block;font-weight:700;font-size:13px;margin-top:14px}' +
    '#moon-reserve select{display:block;width:100%;padding:12px;border:1px solid var(--line,#e6e0d2);font:16px inherit;margin-top:4px;background:#fff;border-radius:0}' +
    '#moon-reserve .mr-price{font:600 26px "Cormorant Garamond",serif;color:var(--gold,#a9863f);margin:16px 0 0}' +
    '#moon-reserve .mr-small{font-size:12px;color:#777;margin:8px 0 0}#moon-reserve .mr-msg{margin:12px 0 0;font-size:14px}' +
    '#moon-reserve .mr-err{color:#b3261e}#moon-reserve .btn{width:100%;border:0;font:inherit;font-weight:700;cursor:pointer;margin-bottom:0}' +
    '#moon-reserve .btn[disabled]{opacity:.45;cursor:default}#moon-reserve a.btn{margin-top:12px}';
  document.head.appendChild(st);

  function mount(pf, id) {
    if (pf.querySelector('.sample')) return; // サンプル表示のキャストは予約不可
    var h1 = pf.querySelector('h1.page'), clone = h1 ? h1.cloneNode(true) : null, name = '';
    if (clone) { var sm = clone.querySelector('.sample'); if (sm) sm.remove(); name = clone.textContent.trim(); }
    name = name.replace(/\(.*\)/, '');

    var sec = document.createElement('section');
    sec.id = 'moon-reserve';
    sec.innerHTML = '<h2 class="sub">ご予約</h2>' +
      '<p class="mr-small" style="font-size:13px;color:inherit">日時とコースを選ぶと、予約内容が入ったSMSが開きます。お名前を書いて送信してください。</p>' +
      '<div id="mr-body">読み込み中…</div>';
    var prof = document.getElementById('prof'), anchor = prof && prof.querySelector('h2.sub');
    if (anchor) anchor.parentNode.insertBefore(sec, anchor); else (prof || pf.parentNode).appendChild(sec);
    var body = sec.querySelector('#mr-body');

    // 出勤情報(今日から7日分)
    var today = jstNow(), from = ymd(today), end = new Date(today); end.setDate(end.getDate() + 6);
    get('public_schedule?select=work_date,start_time,end_time&therapist_id=eq.' + encodeURIComponent(id) +
        '&work_date=gte.' + from + '&work_date=lte.' + ymd(end) + '&order=work_date')
      .then(function (rows) {
        var days = [], seen = {};
        rows.forEach(function (r) { if (!seen[r.work_date]) { seen[r.work_date] = 1; days.push(r); } });
        if (!days.length) { body.innerHTML = '<p class="mr-small" style="font-size:14px">現在ご予約できる出勤日がありません。</p>'; return; }
        ui(days);
      })
      .catch(function () { body.innerHTML = '<p class="mr-small mr-err" style="font-size:14px">予約情報を読み込めませんでした。時間をおいて再読み込みしてください。</p>'; });

    function ui(days) {
      body.innerHTML =
        '<label>ご希望日<select id="mr-date">' + days.map(function (d) {
          var p = d.work_date.split('-'), dt = new Date(+p[0], +p[1] - 1, +p[2]);
          return '<option value="' + esc(d.work_date) + '">' + (+p[1]) + '/' + (+p[2]) + '(' + W[dt.getDay()] + ')　出勤 ' + esc(d.start_time) + '〜' + esc(d.end_time) + '</option>';
        }).join('') + '</select></label>' +
        '<label>コース<select id="mr-course">' + COURSES.map(function (c) { return '<option value="' + c[0] + '">' + c[0] + '分　' + yen(c[1]) + '</option>'; }).join('') + '</select></label>' +
        '<label>ご希望の開始時間<select id="mr-time"></select></label>' +
        '<p class="mr-price" id="mr-price"></p>' +
        '<p class="mr-small">※料金はコース料金です。指名料・オプション料金は別途かかります(<a href="price.html">料金表</a>)。</p>' +
        '<button class="btn" id="mr-go" type="button" style="margin-top:16px">この内容でSMSを作成</button>' +
        '<div id="mr-msg" class="mr-msg" role="status"></div>' +
        '<p class="mr-small">※ボタンを押すと、その時間を30分間おさえます。SMSを送信すると、店長が確認して予約確定となります。30分以内に送信がない場合は、おさえた時間は自動で解除されます。</p>';

      var dSel = body.querySelector('#mr-date'), cSel = body.querySelector('#mr-course'), tSel = body.querySelector('#mr-time'),
          price = body.querySelector('#mr-price'), go = body.querySelector('#mr-go'), msg = body.querySelector('#mr-msg'), busy = [];

      function shiftOf() { return days.filter(function (d) { return d.work_date === dSel.value; })[0]; }
      function priceOf() { return COURSES.filter(function (c) { return c[0] === +cSel.value; })[0][1]; }

      function slots() {
        var sh = shiftOf(), s = mins(sh.start_time), e = mins(sh.end_time), cm = +cSel.value;
        if (e <= s) e += 1440;
        var p = dSel.value.split('-'), midnight = new Date(+p[0], +p[1] - 1, +p[2]).getTime();
        var rel = (jstNow().getTime() - midnight) / 60000 + LEAD_MIN, out = [];
        for (var t = Math.ceil(s / 15) * 15; t + cm <= e; t += 15) {
          if (t < rel) continue;
          var free = busy.every(function (b) {
            var m = mins(b.start_time), a = (e > 1440 && m < s) ? m + 1440 : m, bl = +b.course_minutes || 0;
            return !(t < a + bl + BUFFER && a < t + cm + BUFFER);
          });
          if (free) out.push(t);
        }
        return out;
      }

      function draw() {
        price.textContent = '料金：' + yen(priceOf());
        var list = slots();
        tSel.innerHTML = list.length ? list.map(function (t) { return '<option value="' + hm(t) + '">' + hm(t) + (t >= 1440 ? '（翌日）' : '') + '</option>'; }).join('')
                                     : '<option value="">この条件で空いている時間がありません</option>';
        go.disabled = !list.length;
      }

      function loadBusy() {
        msg.textContent = '';
        get('public_busy?select=start_time,course_minutes&therapist_id=eq.' + encodeURIComponent(id) + '&work_date=eq.' + encodeURIComponent(dSel.value))
          .then(function (r) { busy = r; draw(); })
          .catch(function () { busy = []; draw(); msg.innerHTML = '<span class="mr-err">空き状況を読み込めませんでした。再読み込みしてください。</span>'; go.disabled = true; });
      }

      dSel.onchange = loadBusy;
      cSel.onchange = draw;
      loadBusy();

      go.onclick = function () {
        var time = tSel.value; if (!time) return;
        var date = dSel.value, cm = +cSel.value, p = date.split('-'), dt = new Date(+p[0], +p[1] - 1, +p[2]);
        go.disabled = true; msg.textContent = 'お時間をおさえています…';
        fetch(CFG.url + '/rest/v1/rpc/create_hold', {
          method: 'POST',
          headers: { apikey: CFG.anon, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_therapist_id: id, p_work_date: date, p_start_time: time, p_course_minutes: cm })
        }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error((j && (j.message || j.hint)) || r.status); return j; });
        }).then(function () {
          var text = '【MOONone 予約希望】\n\nお名前（ニックネーム可）：\n\nキャスト：' + name + '\n希望日：' + (+p[1]) + '/' + (+p[2]) + '(' + W[dt.getDay()] + ')' +
            '\n希望時間：' + time + '\nコース：' + cm + '分\n料金：' + yen(priceOf()) + '（コース料金のみ）\n\nお名前をご記入のうえ、\n送信してください。';
          var href = 'sms:' + SMS_TO + (isIOS() ? '&' : '?') + 'body=' + encodeURIComponent(text);
          msg.innerHTML = '<b>' + time + ' からの時間を30分間おさえました。</b><br>SMSが開かない場合は下のボタンを押してください。' +
            '<a class="btn" href="' + href + '">SMSアプリを開く</a>' +
            '<button class="btn" id="mr-again" type="button" style="margin-top:10px;background:#fff;color:inherit;border:1px solid #999">時間を選び直す</button>';
          msg.querySelector('#mr-again').onclick = loadBusy;
          location.href = href;
        }).catch(function (e) {
          var m = String(e && e.message || '');
          var t = /slot taken/.test(m) ? 'この時間は先に埋まりました。別の時間を選んでください。'
                : /too many/.test(m) ? '短時間に続けておさえられません。しばらくしてからお試しください。'
                : /outside shift|not working/.test(m) ? 'この時間は受付できません。別の時間を選んでください。'
                : '予約を作成できませんでした。時間をおいてもう一度お試しください。';
          msg.innerHTML = '<span class="mr-err">' + t + '</span>';
          loadBusy();
          setTimeout(function () { msg.innerHTML = '<span class="mr-err">' + t + '</span>'; }, 600);
        });
      };
    }
  }

  function tryMount() {
    var pf = document.querySelector('#prof .pf');
    if (!pf || document.getElementById('moon-reserve')) return;
    var id = window.__PID || new URLSearchParams(location.search).get('id');
    if (id) mount(pf, id);
  }
  new MutationObserver(tryMount).observe(document.documentElement, { childList: true, subtree: true });
  tryMount();
})();
