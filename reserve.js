/* MOONone お客様側の予約機能
   空き状況取得のタイムアウト・エラー診断版
*/
(function () {
  'use strict';

  var CFG = window.MOON_CONFIG || {};
  if (!CFG.url || !CFG.anon) return;

  var SMS_TO = '07055755034';
  var LEAD_MIN = 30;
  var BUFFER = 15;

  var COURSES = [
    [60, 16000],
    [70, 18000],
    [90, 22000],
    [120, 27000],
    [150, 32000]
  ];

  var NOMINATION_FEE = 2000;

  var OILS = [
    ['ノーマルオイル', 0],
    ['ディープオイル', 2000],
    ['極みオイル', 3000]
  ];

  var W = '日月火水木金土';

  var pad = function (n) {
    return String(n).padStart(2, '0');
  };

  var esc = function (t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[c];
    });
  };

  var yen = function (n) {
    return Number(n).toLocaleString('ja-JP') + '円';
  };

  var mins = function (t) {
    var m = /^(\d{1,2}):(\d{2})/.exec(t || '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  };

  var hm = function (n) {
    n = ((n % 1440) + 1440) % 1440;
    return pad(Math.floor(n / 60)) + ':' + pad(n % 60);
  };

  var ymd = function (d) {
    return d.getFullYear() + '-' +
      pad(d.getMonth() + 1) + '-' +
      pad(d.getDate());
  };

  var jstNow = function () {
    return new Date(
      new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Tokyo'
      })
    );
  };

  var dateDiff = function (a, b) {
    var aa = a.split('-').map(Number);
    var bb = b.split('-').map(Number);

    return Math.round(
      (Date.UTC(aa[0], aa[1] - 1, aa[2]) -
       Date.UTC(bb[0], bb[1] - 1, bb[2])) / 86400000
    );
  };

  var isIOS = function () {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' &&
       navigator.maxTouchPoints > 1);
  };

  // 通信処理：10秒でタイムアウト
  function get(path) {
    var controller = new AbortController();

    var timer = setTimeout(function () {
      controller.abort();
    }, 10000);

    return fetch(CFG.url + '/rest/v1/' + path, {
      headers: {
        apikey: CFG.anon
      },
      signal: controller.signal
    }).then(function (r) {
      return r.text().then(function (raw) {
        var data;

        try {
          data = raw ? JSON.parse(raw) : [];
        } catch (_) {
          data = { raw_response: raw };
        }

        if (!r.ok) {
          var err = new Error(
            data.message ||
            data.error ||
            data.hint ||
            ('HTTP ' + r.status + ' ' + r.statusText)
          );

          err.status = r.status;
          err.code = data.code || '';
          err.details = data.details || '';
          err.hint = data.hint || '';
          err.response = raw;

          throw err;
        }

        return data;
      });
    }).catch(function (e) {
      if (e.name === 'AbortError') {
        throw new Error(
          '通信が10秒以内に完了しませんでした。'
        );
      }

      throw e;
    }).finally(function () {
      clearTimeout(timer);
    });
  }

  // 予約欄デザイン
  var st = document.createElement('style');

  st.textContent =
    '#moon-reserve{margin-top:8px}' +
    '#moon-reserve label{display:block;font-weight:700;font-size:13px;margin-top:14px}' +
    '#moon-reserve select{display:block;width:100%;padding:12px;border:1px solid var(--line,#e6e0d2);font:16px inherit;margin-top:4px;background:#fff;border-radius:0}' +
    '#moon-reserve .mr-price{font:600 26px "Cormorant Garamond",serif;color:var(--gold,#a9863f);margin:16px 0 0}' +
    '#moon-reserve .mr-small{font-size:12px;color:#777;margin:8px 0 0}' +
    '#moon-reserve .mr-msg{margin:12px 0 0;font-size:14px}' +
    '#moon-reserve .mr-err{color:#b3261e;white-space:pre-wrap;overflow-wrap:anywhere}' +
    '#moon-reserve .btn{width:100%;border:0;font:inherit;font-weight:700;cursor:pointer;margin-bottom:0}' +
    '#moon-reserve .btn[disabled]{opacity:.45;cursor:default}' +
    '#moon-reserve a.btn{display:block;text-align:center;margin-top:12px}';

  document.head.appendChild(st);

  function mount(pf, id) {
    if (document.getElementById('moon-reserve')) return;

    var h1 = pf.querySelector('h1.page');
    var clone = h1 ? h1.cloneNode(true) : null;
    var name = '';

    if (clone) {
      var sm = clone.querySelector('.sample');
      if (sm) sm.remove();
      name = clone.textContent.trim();
    }

    name = name.replace(/\(.*\)/, '');

    var sec = document.createElement('section');
    sec.id = 'moon-reserve';

    sec.innerHTML =
      '<h2 class="sub">ご予約</h2>' +
      '<p class="mr-small" style="font-size:13px;color:inherit">' +
      '日時とコースを選ぶと、予約内容が入ったSMSが開きます。' +
      'お名前を書いて送信してください。</p>' +
      '<div id="mr-body">読み込み中…</div>';

    var prof = document.getElementById('prof');
    var anchor = prof && prof.querySelector('h2.sub');

    if (anchor) {
      anchor.parentNode.insertBefore(sec, anchor);
    } else {
      (prof || pf.parentNode).appendChild(sec);
    }

    var body = sec.querySelector('#mr-body');

    var today = jstNow();
    var from = ymd(today);
    var end = new Date(today);
    end.setDate(end.getDate() + 6);

    get(
      'public_schedule?select=work_date,start_time,end_time' +
      '&therapist_id=eq.' + encodeURIComponent(id) +
      '&work_date=gte.' + from +
      '&work_date=lte.' + ymd(end) +
      '&order=work_date'
    ).then(function (rows) {
      var days = [];
      var seen = {};

      rows.forEach(function (r) {
        if (!seen[r.work_date]) {
          seen[r.work_date] = 1;
          days.push(r);
        }
      });

      if (!days.length) {
        body.innerHTML =
          '<p class="mr-small" style="font-size:14px">' +
          '現在ご予約できる出勤日がありません。</p>';
        return;
      }

      ui(days);

    }).catch(function (e) {
      body.innerHTML =
        '<p class="mr-small mr-err" style="font-size:14px">' +
        '出勤情報の取得に失敗しました。\n' +
        'エラー：' + esc(e.message) +
        '</p>';
    });

    function ui(days) {
      body.innerHTML =
        '<label>ご希望日<select id="mr-date">' +
        days.map(function (d) {
          var p = d.work_date.split('-');
          var dt = new Date(+p[0], +p[1] - 1, +p[2]);

          return '<option value="' + esc(d.work_date) + '">' +
            (+p[1]) + '/' + (+p[2]) + '(' + W[dt.getDay()] + ')' +
            '　出勤 ' + esc(d.start_time) + '〜' +
            esc(d.end_time) + '</option>';
        }).join('') +
        '</select></label>' +

        '<label>コース<select id="mr-course">' +
        COURSES.map(function (c) {
          return '<option value="' + c[0] + '">' +
            c[0] + '分　' + yen(c[1]) + '</option>';
        }).join('') +
        '</select></label>' +

        '<label>指名</label>' +
        '<p class="mr-small">本指名　' + yen(NOMINATION_FEE) + '</p>' +

        '<label>オイル<select id="mr-oil">' +
        OILS.map(function (o, i) {
          return '<option value="' + i + '">' +
            o[0] + '　' + (o[1] ? '+' + yen(o[1]) : '無料') +
            '</option>';
        }).join('') +
        '</select></label>' +

        '<label>ご希望の開始時間<select id="mr-time"></select></label>' +

        '<p class="mr-price" id="mr-price"></p>' +

        '<p class="mr-small">' +
        '※料金はコース料金・本指名料・オイル料金の合計です。</p>' +

        '<button class="btn" id="mr-go" type="button" style="margin-top:16px">' +
        'この内容でSMSを作成</button>' +

        '<div id="mr-msg" class="mr-msg" role="status"></div>' +

        '<p class="mr-small">' +
        '※ボタンを押すと、その時間を30分間仮押さえします。' +
        'SMSを送信後、店長が確認して予約確定となります。' +
        '30分以内に送信がない場合、仮押さえは空き枠に戻ります。</p>';

      var dSel = body.querySelector('#mr-date');
      var cSel = body.querySelector('#mr-course');
      var tSel = body.querySelector('#mr-time');
      var oSel = body.querySelector('#mr-oil');
      var price = body.querySelector('#mr-price');
      var go = body.querySelector('#mr-go');
      var msg = body.querySelector('#mr-msg');

      var busy = [];
      var busyReady = false;

      function shiftOf() {
        return days.filter(function (d) {
          return d.work_date === dSel.value;
        })[0];
      }

      function oilOf() {
        return OILS[Number(oSel.value)];
      }

      function priceOf() {
        var course = COURSES.filter(function (c) {
          return c[0] === Number(cSel.value);
        })[0];

        return course[1] + NOMINATION_FEE + oilOf()[1];
      }

      function slots() {
        var sh = shiftOf();
        if (!sh || !busyReady) return [];

        var s = mins(sh.start_time);
        var e = mins(sh.end_time);
        var cm = Number(cSel.value);

        if (e <= s) e += 1440;

        var now = jstNow();
        var nowDate = ymd(now);
        var nowMin = now.getHours() * 60 + now.getMinutes();

        var nowRelative =
          dateDiff(nowDate, dSel.value) * 1440 + nowMin;

        var earliest = nowRelative + LEAD_MIN;
        var out = [];

        for (var t = Math.ceil(s / 15) * 15;
             t + cm <= e;
             t += 15) {

          if (t < earliest) continue;

          var free = busy.every(function (b) {
            var diff = dateDiff(b.work_date, dSel.value);

            var reservationStart =
              diff * 1440 +
              Number(b.start_day_offset || 0) * 1440 +
              mins(b.start_time);

            var reservationEnd =
              diff * 1440 +
              Number(b.end_day_offset || 0) * 1440 +
              mins(b.end_time);

            return !(
              t < reservationEnd + BUFFER &&
              reservationStart < t + cm + BUFFER
            );
          });

          if (free) out.push(t);
        }

        return out;
      }

      function draw() {
        price.textContent = '料金：' + yen(priceOf());

        var list = slots();

        tSel.innerHTML = list.length
          ? list.map(function (t) {
              return '<option value="' + hm(t) + '">' +
                hm(t) +
                (t >= 1440 ? '（翌日）' : '') +
                '</option>';
            }).join('')
          : '<option value="">空いている時間がありません</option>';

        go.disabled = !busyReady || !list.length;
      }

      // 空き状況取得
      function loadBusy() {
        busyReady = false;
        busy = [];
        go.disabled = true;
        msg.textContent = '空き状況を確認しています…';

        var date = dSel.value;
        var before = new Date(date + 'T00:00:00Z');
        var after = new Date(date + 'T00:00:00Z');

        before.setUTCDate(before.getUTCDate() - 1);
        after.setUTCDate(after.getUTCDate() + 1);

        var fromDate = before.toISOString().slice(0, 10);
        var toDate = after.toISOString().slice(0, 10);

        get(
          'public_busy?select=therapist_id,work_date,start_time,end_time,' +
          'start_day_offset,end_day_offset,course_minutes' +
          '&therapist_id=eq.' + encodeURIComponent(id) +
          '&work_date=gte.' + fromDate +
          '&work_date=lte.' + toDate
        ).then(function (rows) {
          busy = rows;
          busyReady = true;
          msg.textContent = '';
          draw();

        }).catch(function (e) {
          busyReady = false;
          busy = [];
          draw();

          console.error('[MOONone public_busy error]', e);

          msg.innerHTML =
            '<div class="mr-err">' +
            '空き状況の取得に失敗しました。\n' +
            'HTTP：' + esc(e.status || '不明') + '\n' +
            'コード：' + esc(e.code || '不明') + '\n' +
            'メッセージ：' + esc(e.message || '不明') + '\n' +
            '詳細：' + esc(e.details || 'なし') + '\n' +
            '補足：' + esc(e.hint || 'なし') + '\n' +
            '応答：' + esc(e.response || 'なし') +
            '</div>';
        });
      }

      dSel.onchange = loadBusy;
      cSel.onchange = draw;
      oSel.onchange = draw;

      loadBusy();

      // 予約ボタン
      go.onclick = function () {
        var time = tSel.value;
        if (!time || !busyReady) return;

        var date = dSel.value;
        var cm = Number(cSel.value);
        var p = date.split('-');
        var dt = new Date(+p[0], +p[1] - 1, +p[2]);

        go.disabled = true;
        msg.textContent = 'お時間を仮押さえしています…';

        fetch(CFG.url + '/rest/v1/rpc/create_hold', {
          method: 'POST',
          headers: {
            apikey: CFG.anon,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            p_therapist_id: id,
            p_work_date: date,
            p_start_time: time,
            p_course_minutes: cm
          })
        }).then(function (r) {
          return r.text().then(function (raw) {
            var j = {};

            try {
              j = raw ? JSON.parse(raw) : {};
            } catch (_) {
              j = { raw_response: raw };
            }

            if (!r.ok) {
              var err = new Error(
                j.message || j.error || j.hint ||
                j.details || ('HTTP ' + r.status)
              );

              err.status = r.status;
              err.code = j.code || '';
              err.details = j.details || '';
              err.hint = j.hint || '';
              err.response = raw;

              throw err;
            }

            return j;
          });
        }).then(function () {
          var oil = oilOf();
          var total = priceOf();

          var smsText =
            '【MOONone 予約希望】\n\n' +
            'お名前（ニックネーム可）：\n\n' +
            'キャスト：' + name + '\n' +
            '希望日：' + (+p[1]) + '/' + (+p[2]) +
            '(' + W[dt.getDay()] + ')\n' +
            '希望時間：' + time + '\n' +
            'コース：' + cm + '分\n' +
            '指名：本指名\n' +
            '指名料：' + yen(NOMINATION_FEE) + '\n' +
            'オイル：' + oil[0] + '\n' +
            'オイル料金：' + yen(oil[1]) + '\n' +
            'コース料金：' +
            yen(COURSES.filter(function (c) {
              return c[0] === cm;
            })[0][1]) + '\n' +
            '合計料金：' + yen(total) + '\n\n' +
            'お名前をご記入のうえ、送信してください。';

          var href =
            'sms:' + SMS_TO +
            (isIOS() ? '&' : '?') +
            'body=' + encodeURIComponent(smsText);

          msg.innerHTML =
            '<b>' + esc(time) +
            ' からの時間を30分間仮押さえしました。</b>' +
            '<p>SMSが開かない場合は下のボタンを押してください。</p>' +
            '<a class="btn" href="' + esc(href) + '">' +
            'SMSアプリを開く</a>';

          location.href = href;

        }).catch(function (e) {
          console.error('[MOONone create_hold error]', e);

          var detail = [
            '予約作成エラー',
            'HTTPステータス：' + (e.status || '不明'),
            'エラーコード：' + (e.code || '不明'),
            'メッセージ：' + (e.message || '不明'),
            '詳細：' + (e.details || 'なし'),
            '補足：' + (e.hint || 'なし'),
            '応答内容：' + (e.response || 'なし')
          ].join('\n');

          msg.innerHTML =
            '<div class="mr-err">' + esc(detail) + '</div>';

          go.disabled = false;
        };
      };
    }
  }

  function tryMount() {
    var pf = document.querySelector('#prof .pf');

    if (!pf || document.getElementById('moon-reserve')) return;

    var id = window.__PID ||
      new URLSearchParams(location.search).get('id');

    if (id) mount(pf, id);
  }

  new MutationObserver(tryMount).observe(
    document.documentElement,
    {
      childList: true,
      subtree: true
    }
  );

  tryMount();
})();
