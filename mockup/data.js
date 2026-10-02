/* Sinh tự động bởi build-mockup.js — KHÔNG sửa tay; hãy sửa shots.json rồi chạy `node build-mockup.js data`. */
window.NC_MOCKUP = {
 "generated_at": "2026-10-02T07:30:49.492Z",
 "browserHost": "nomadcare.demo",
 "devices": {
  "phone": {
   "label": "iPhone 390 × 844 @3x",
   "width": 390,
   "height": 844,
   "scale": 3,
   "mobile": true,
   "touch": true,
   "safeArea": {
    "top": 47,
    "bottom": 34
   },
   "ua": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
  },
  "tablet": {
   "label": "iPad 834 × 1194 @2x",
   "width": 834,
   "height": 1194,
   "scale": 2,
   "mobile": true,
   "touch": true,
   "safeArea": {
    "top": 24,
    "bottom": 20
   },
   "ua": "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
  },
  "desktop": {
   "label": "Desktop 1440 × 900 @2x",
   "width": 1440,
   "height": 900,
   "scale": 2,
   "mobile": false,
   "touch": false
  }
 },
 "modules": {
  "MOD.01": {
   "name": {
    "vi": "Dịch y tế 1 chạm",
    "en": "One-tap medical translation"
   },
   "icon": "chat",
   "desc": {
    "vi": "Chạm vào hình cơ thể (6 nhóm) → triệu chứng → mức độ → màn hình song ngữ chữ lớn cho nhân viên y tế. Không cần mạng, không cần gõ chữ.",
    "en": "Tap the body figure (6 areas) → symptom → severity → large bilingual screen for local medical staff. No network, no typing."
   }
  },
  "MOD.02": {
   "name": {
    "vi": "Bản đồ & định tuyến offline",
    "en": "Offline map & routing"
   },
   "icon": "map",
   "desc": {
    "vi": "A* trên gói dữ liệu hành lang tuyến, tô màu theo 3 mức sóng của nhà mạng; cơ sở y tế đã xác thực gần nhất và điểm dừng thiết yếu.",
    "en": "A* on corridor data packs, route coloured by 3-level signal for your carrier; nearest verified facilities and essential stops."
   }
  },
  "MOD.03": {
   "name": {
    "vi": "Hồ sơ QR sinh tồn",
    "en": "Survival QR profile"
   },
   "icon": "qr",
   "desc": {
    "vi": "Lớp công khai (nhóm máu, dị ứng, bệnh nền, thuốc) quét được cả khi máy khoá; lớp định danh chỉ mở sau thao tác xác nhận. Mã hoá trên máy.",
    "en": "Public layer (blood type, allergies, conditions, medications) scannable on the lock screen; identity only after hold-to-confirm. Encrypted on device."
   }
  },
  "MOD.04": {
   "name": {
    "vi": "Buddy Check-in",
    "en": "Buddy Check-in"
   },
   "icon": "shield",
   "desc": {
    "vi": "Cảnh báo trước khi vào vùng mất sóng + dead-man switch: quá hạn check-in thì gửi vị trí cuối cho người thân (xếp hàng khi offline).",
    "en": "Warns before dead zones + dead-man switch: a missed check-in sends your last location to your contact (queued offline)."
   }
  },
  "MOD.05": {
   "name": {
    "vi": "Thư viện sơ cứu offline",
    "en": "Offline first-aid library"
   },
   "icon": "cross",
   "desc": {
    "vi": "Hướng dẫn từng bước có minh hoạ, dấu hiệu phải gọi 115, điều không nên làm, nhịp CPR 110 lần/phút, danh mục túi y tế.",
    "en": "Illustrated steps, red flags for 115, don'ts, CPR compression counter (110/min), medical kit checklist."
   }
  }
 },
 "boards": {
  "mobile": {
   "name": {
    "vi": "Giao diện di động (1)",
    "en": "Mobile interface (1)"
   },
   "file": "board-mobile.png",
   "width": 4000,
   "height": 1250,
   "layout": "banner",
   "variant": "brand",
   "title": {
    "vi": "GIAO DIỆN DI ĐỘNG",
    "en": "MOBILE INTERFACE"
   },
   "subtitle": {
    "vi": "PWA offline-first · 5 module cứu hộ · iPhone 390 × 844",
    "en": "Offline-first PWA · 5 safety modules · iPhone 390 × 844"
   },
   "shots": [
    "p-onboarding",
    "p-home",
    "p-tr-figure",
    "p-tr-result",
    "p-map-route",
    "p-qr-owner",
    "p-buddy-active",
    "p-fa-library",
    "p-emergency"
   ]
  },
  "mobile-2": {
   "name": {
    "vi": "Giao diện di động (2)",
    "en": "Mobile interface (2)"
   },
   "file": "board-mobile-2.png",
   "width": 4000,
   "height": 1250,
   "layout": "banner",
   "variant": "light",
   "title": {
    "vi": "GIAO DIỆN",
    "en": "INTERFACE"
   },
   "subtitle": {
    "vi": "Riêng tư · Định tuyến theo sóng · Nhắc trước vùng mất sóng",
    "en": "Privacy · Signal-aware routing · Dead-zone reminders"
   },
   "shots": [
    "p-onboarding-consent",
    "p-geo-permission",
    "p-map-basemap",
    "p-map-start",
    "p-map-nearest",
    "p-buddy-setup",
    "p-buddy-alert",
    "p-qr-rescuer",
    "p-fa-step"
   ]
  },
  "tablet": {
   "name": {
    "vi": "Máy tính bảng",
    "en": "Tablet"
   },
   "file": "board-tablet.png",
   "width": 3840,
   "height": 2160,
   "layout": "tablet",
   "variant": "brand",
   "title": {
    "vi": "GIAO DIỆN MÁY TÍNH BẢNG",
    "en": "TABLET INTERFACE"
   },
   "subtitle": {
    "vi": "Bố cục 2 cột · thanh điều hướng rail · iPad 834 × 1194",
    "en": "Two-column layout · navigation rail · iPad 834 × 1194"
   },
   "shots": [
    "t-home",
    "t-map",
    "t-translate"
   ]
  },
  "desktop": {
   "name": {
    "vi": "Web & dashboard quản trị",
    "en": "Web & admin dashboard"
   },
   "file": "board-desktop.png",
   "width": 3840,
   "height": 2160,
   "layout": "desktop",
   "variant": "light",
   "title": {
    "vi": "WEB & DASHBOARD QUẢN TRỊ",
    "en": "WEB APP & ADMIN DASHBOARD"
   },
   "subtitle": {
    "vi": "Cùng một mã nguồn PWA · Supabase (PostgreSQL + PostGIS) · 1440 × 900",
    "en": "One PWA codebase · Supabase (PostgreSQL + PostGIS) · 1440 × 900"
   },
   "groups": {
    "app": {
     "vi": "Ứng dụng web (PWA)",
     "en": "Web app (PWA)"
    },
    "admin": {
     "vi": "Dashboard quản trị",
     "en": "Admin dashboard"
    }
   },
   "shots": [
    "d-home",
    "a-overview",
    "d-nav-collapsed",
    "d-buddy",
    "a-buddy",
    "a-signal"
   ]
  },
  "flow-mod01": {
   "name": {
    "vi": "Luồng MOD.01 dưới 15 giây",
    "en": "MOD.01 flow under 15 s"
   },
   "file": "board-flow-mod01.png",
   "width": 3840,
   "height": 2160,
   "layout": "flow",
   "variant": "light",
   "title": {
    "vi": "LUỒNG MOD.01 — DỊCH Y TẾ 1 CHẠM",
    "en": "MOD.01 FLOW — ONE-TAP MEDICAL TRANSLATION"
   },
   "subtitle": {
    "vi": "5 bước, chạm là xong: không gõ chữ, không cần mạng",
    "en": "5 steps, tap only: no typing, no network"
   },
   "shots": [
    "p-flow-home",
    "p-tr-body",
    "p-tr-symptom",
    "p-tr-severity",
    "p-tr-result"
   ],
   "steps": [
    {
     "title": {
      "vi": "Mở app",
      "en": "Open the app"
     },
     "sub": {
      "vi": "1 chạm từ màn hình khoá",
      "en": "1 tap from the lock screen"
     },
     "sec": 2
    },
    {
     "title": {
      "vi": "Chọn vùng cơ thể",
      "en": "Pick a body area"
     },
     "sub": {
      "vi": "6 nhóm",
      "en": "6 groups"
     },
     "sec": 3
    },
    {
     "title": {
      "vi": "Chọn triệu chứng",
      "en": "Pick a symptom"
     },
     "sub": {
      "vi": "cây quyết định, tối đa 2 cấp",
      "en": "decision tree, max 2 levels"
     },
     "sec": 6
    },
    {
     "title": {
      "vi": "Chọn mức độ",
      "en": "Pick severity"
     },
     "sub": {
      "vi": "nhẹ / vừa / nặng",
      "en": "mild / moderate / severe"
     },
     "sec": 2
    },
    {
     "title": {
      "vi": "Màn hình song ngữ",
      "en": "Bilingual screen"
     },
     "sub": {
      "vi": "chữ lớn, đưa nhân viên y tế đọc",
      "en": "large type for medical staff"
     },
     "sec": 0
    }
   ],
   "target": {
    "vi": "Tổng thời gian thao tác mục tiêu: dưới 15 giây, không cần nhập chữ, không cần kết nối mạng",
    "en": "Target total time: under 15 seconds, no typing, no network connection"
   },
   "note": {
    "vi": "Thời gian từng bước là giả thuyết thiết kế (Hình 2 thuyết minh), sẽ được đo lại trong thử nghiệm thực địa (mục 3.3).",
    "en": "Per-step timings are design hypotheses (Figure 2), to be re-measured in field tests (section 3.3)."
   }
  },
  "dark": {
   "name": {
    "vi": "Chế độ tối",
    "en": "Dark mode"
   },
   "file": "board-dark.png",
   "width": 4000,
   "height": 1320,
   "layout": "banner",
   "variant": "dark",
   "title": {
    "vi": "CHẾ ĐỘ TỐI",
    "en": "DARK MODE"
   },
   "subtitle": {
    "vi": "Tự động theo hệ thống · tương phản cao · SOS luôn màu đỏ",
    "en": "Follows the system · high contrast · SOS always red"
   },
   "shots": [
    "p-home-dark",
    "p-tr-result-dark",
    "p-map-dark",
    "p-qr-owner-dark",
    "p-buddy-dark",
    "p-fa-cpr-dark",
    "p-emergency-dark"
   ]
  },
  "overview": {
   "name": {
    "vi": "Board tổng hợp",
    "en": "Overview board"
   },
   "file": "board-overview.png",
   "width": 3840,
   "height": 2160,
   "layout": "overview",
   "variant": "brand",
   "title": {
    "vi": "Bản phác thảo giao diện sản phẩm demo",
    "en": "Demo product interface mockup"
   },
   "subtitle": {
    "vi": "Ứng dụng an toàn y tế offline-first cho phượt thủ · PWA điện thoại, máy tính bảng, web + dashboard quản trị",
    "en": "Offline-first medical-safety app for backpackers · phone, tablet, web PWA + admin dashboard"
   },
   "shots": [
    "d-home",
    "t-map",
    "p-tr-result",
    "p-home",
    "p-buddy-active"
   ]
  }
 },
 "shots": [
  {
   "id": "p-onboarding",
   "device": "phone",
   "url": "/index.html?reset=1",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "Onboarding",
   "caption": {
    "vi": "Chào mừng & chọn ngôn ngữ",
    "en": "Welcome & language"
   },
   "actions": [
    {
     "goto": "/index.html"
    },
    {
     "waitFor": "#ob-root .ob-step",
     "timeout": 8000
    },
    {
     "wait": 700
    }
   ],
   "live": "/index.html?demo=1#/onboarding",
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 240,
    "bottomLum": 254
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-onboarding-consent",
   "device": "phone",
   "url": "/index.html?reset=1",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "Onboarding",
   "caption": {
    "vi": "Đồng ý riêng cho dữ liệu y tế (NĐ 356/2025)",
    "en": "Separate consent for medical data"
   },
   "actions": [
    {
     "goto": "/index.html"
    },
    {
     "waitFor": "#ob-root .ob-step",
     "timeout": 8000
    },
    {
     "wait": 700
    },
    {
     "click": "#ob-next"
    },
    {
     "wait": 700
    },
    {
     "click": "#ob-next"
    },
    {
     "wait": 800
    }
   ],
   "live": "/index.html?demo=1#/onboarding",
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 239,
    "bottomLum": 254
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-geo-permission",
   "device": "phone",
   "url": "/index.html?demo=1#/home",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "Trang chủ",
   "caption": {
    "vi": "Xin quyền vị trí: giải thích trước, chỉ hỏi khi bấm “Cho phép”",
    "en": "Location permission: explained first, asked only on “Allow”"
   },
   "actions": [
    {
     "waitFor": ".geo-sheet.is-open",
     "timeout": 8000
    },
    {
     "wait": 700
    },
    {
     "eval": "(function(){ var a = document.activeElement; if (a && a !== document.body && a.blur) { a.blur(); return 'blur ' + a.tagName; } return 'no focus'; })()"
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "light",
    "bottom": "dark",
    "topLum": 141,
    "bottomLum": 255
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-home",
   "device": "phone",
   "url": "/index.html?demo=1#/settings",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "Trang chủ",
   "caption": {
    "vi": "Trang chủ — sẵn sàng offline",
    "en": "Home — offline-ready"
   },
   "actions": [
    {
     "eval": "(async function(){ await NC.data.init(); var r = NC.settings.get('route_id') || 'ha-giang-loop', c = NC.settings.get('carrier') || 'viettel'; var have = await NC.data.listDownloadedPacks(); if (!have.some(function (x) { return x.route_id === r && x.carrier === c; })) await NC.data.downloadPack(r, c); return 'pack ' + r + ':' + c + ' → ' + (await NC.data.listDownloadedPacks()).length; })()"
    },
    {
     "eval": "(async function(){ if (!(window.NC && NC.data && NC.data.buddy)) throw new Error('NC.data.buddy chưa có'); if (NC.data.init) await NC.data.init(); var cur = await NC.data.buddy.current(); if (!cur || cur.status === 'closed') { await NC.data.buddy.start({ traveler_name: 'Minh Anh', recipient: { name: 'Lê Hà', phone: '+84 000 000 001' }, interval_min: 60, grace_min: 30, route_id: 'ha-giang-loop', travel_mode: 'motorbike', share_public_medical: false, public_medical: null }); } var p = NC.settings.get('last_position'); try { await NC.data.buddy.checkin(p ? { kind: 'location', lat: p.lat, lng: p.lng, accuracy_m: 12 } : { kind: 'checkin' }); } catch (e) {} return 'buddy ' + ((await NC.data.buddy.current()) || {}).status; })()"
    },
    {
     "wait": 600
    },
    {
     "go": "home"
    },
    {
     "wait": 1400
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 245,
    "bottomLum": 254
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-flow-home",
   "device": "phone",
   "url": "/index.html?demo=1#/home",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.01",
   "caption": {
    "vi": "Mở app — 1 chạm tới MOD.01",
    "en": "Open the app — 1 tap to MOD.01"
   },
   "actions": [
    {
     "wait": 600
    },
    {
     "tap": {
      "sel": "#screen-home .hm-mods a[href='#/translate']"
     }
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 245,
    "bottomLum": 254
   },
   "taps": [
    {
     "x": 0.1287,
     "y": 0.2998,
     "w": 0.1754,
     "h": 0.0995
    }
   ],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-tr-body",
   "device": "phone",
   "url": "/index.html?demo=1#/translate",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.01",
   "caption": {
    "vi": "Chạm vào vùng trên hình cơ thể (6 nhóm)",
    "en": "Tap the body figure (6 groups)"
   },
   "actions": [
    {
     "tap": {
      "sel": "#screen-translate [data-tr-act='group'][data-id='chest']"
     }
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 245,
    "bottomLum": 253
   },
   "taps": [
    {
     "x": 0.5,
     "y": 0.5902,
     "w": 0.1206,
     "h": 0.0524
    }
   ],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-tr-figure",
   "device": "phone",
   "url": "/index.html?demo=1#/translate",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.01",
   "caption": {
    "vi": "Bước 1 chỉ còn hình cơ thể — chạm hiện nhãn song ngữ",
    "en": "Step 1 is just the body figure — bilingual label on touch"
   },
   "actions": [
    {
     "waitFor": "#screen-translate [data-tr-act='group'][data-id='chest']",
     "timeout": 8000
    },
    {
     "eval": "(function(){ var b = document.querySelector(\"#screen-translate .tr-hot--chest\"); if (!b) throw new Error('.tr-hot--chest không có'); b.classList.add('is-hot', 'is-press'); return 'press chest'; })()"
    },
    {
     "wait": 500
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 245,
    "bottomLum": 253
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-tr-symptom",
   "device": "phone",
   "url": "/index.html?demo=1#/translate",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.01",
   "caption": {
    "vi": "Chọn triệu chứng",
    "en": "Pick a symptom"
   },
   "actions": [
    {
     "clickText": "",
     "sel": "#screen-translate [data-tr-act='group'][data-id='chest']"
    },
    {
     "wait": 600
    },
    {
     "tap": {
      "sel": "#screen-translate [data-tr-act='symptom'][data-id='breathing']"
     }
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 245,
    "bottomLum": 254
   },
   "taps": [
    {
     "x": 0.5,
     "y": 0.5979,
     "w": 0.9128,
     "h": 0.09
    }
   ],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-tr-severity",
   "device": "phone",
   "url": "/index.html?demo=1#/translate",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.01",
   "caption": {
    "vi": "Chọn mức độ Nhẹ / Vừa / Nặng",
    "en": "Pick severity: mild / moderate / severe"
   },
   "actions": [
    {
     "clickText": "",
     "sel": "#screen-translate [data-tr-act='group'][data-id='chest']"
    },
    {
     "wait": 600
    },
    {
     "clickText": "",
     "sel": "#screen-translate [data-tr-act='symptom'][data-id='breathing']"
    },
    {
     "wait": 600
    },
    {
     "tap": {
      "sel": "#screen-translate [data-tr-act='sev'][data-id='severe']"
     }
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 245,
    "bottomLum": 254
   },
   "taps": [
    {
     "x": 0.5,
     "y": 0.7165,
     "w": 0.9179,
     "h": 0.1256
    }
   ],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-tr-result",
   "device": "phone",
   "url": "/index.html?demo=1#/translate",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.01",
   "caption": {
    "vi": "Câu y tế mức Nặng — song ngữ, nút Gọi 115",
    "en": "Severe phrase — bilingual, Call 115"
   },
   "actions": [
    {
     "clickText": "",
     "sel": "#screen-translate [data-tr-act='group'][data-id='chest']"
    },
    {
     "wait": 600
    },
    {
     "clickText": "",
     "sel": "#screen-translate [data-tr-act='symptom'][data-id='breathing']"
    },
    {
     "wait": 600
    },
    {
     "clickText": "",
     "sel": "#screen-translate [data-tr-act='sev'][data-id='severe']"
    },
    {
     "wait": 900
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 245,
    "bottomLum": 250
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-map-route",
   "device": "phone",
   "url": "/index.html?demo=1#/map?from=hg-meo-vac&to=hg-ha-giang&strategy=shortest&tab=route&snap=half",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.02",
   "caption": {
    "vi": "Lộ trình A* Mèo Vạc → Hà Giang, tô màu theo sóng",
    "en": "A* route Mèo Vạc → Hà Giang by signal"
   },
   "actions": [
    {
     "wait": 2500
    },
    {
     "eval": "(async function(){ try { await __mk.waitFor('.mk-bm-sug.is-open', 3500); } catch (e) { return 'no basemap sheet'; } var s = document.querySelector('.mk-bm-sug.is-open'); var b = Array.prototype.find.call(s.querySelectorAll('button'), function (x) { return /Để sau|Later|Not now/i.test(x.textContent); }); if (!b) throw new Error('nút Để sau không có'); b.click(); await __mk.sleep(600); return 'basemap sheet dismissed'; })()"
    },
    {
     "eval": "(function(){ var e = document.getElementById('mp-result'); if (!e) throw new Error('#mp-result không có'); e.scrollIntoView({ block: 'start' }); return 'scrolled'; })()"
    },
    {
     "wait": 500
    },
    {
     "tiles": true
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 245,
    "bottomLum": 253
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-map-basemap",
   "device": "phone",
   "url": "/index.html?demo=1#/map?from=hg-meo-vac&to=hg-ha-giang&strategy=shortest&tab=route&snap=half",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.02",
   "caption": {
    "vi": "Tuyến qua vùng mất sóng → gợi ý tải nền bản đồ offline",
    "en": "Route through dead zones → offline basemap suggestion"
   },
   "actions": [
    {
     "wait": 2500
    },
    {
     "waitFor": ".mk-bm-sug.is-open",
     "timeout": 8000
    },
    {
     "wait": 500
    },
    {
     "tiles": true
    },
    {
     "eval": "(function(){ var a = document.activeElement; if (a && a !== document.body && a.blur) { a.blur(); return 'blur ' + a.tagName; } return 'no focus'; })()"
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "light",
    "bottom": "dark",
    "topLum": 141,
    "bottomLum": 255
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-map-start",
   "device": "phone",
   "url": "/index.html?demo=1#/map?from=hg-meo-vac&to=hg-ha-giang&strategy=shortest&tab=route&snap=full",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.02",
   "caption": {
    "vi": "“Bắt đầu đi”: nhắc trước mỗi vùng mất sóng, không theo dõi GPS",
    "en": "“Start trip”: a reminder before each dead zone, no GPS tracking"
   },
   "actions": [
    {
     "wait": 2500
    },
    {
     "eval": "(async function(){ try { await __mk.waitFor('.mk-bm-sug.is-open', 3500); } catch (e) { return 'no basemap sheet'; } var s = document.querySelector('.mk-bm-sug.is-open'); var b = Array.prototype.find.call(s.querySelectorAll('button'), function (x) { return /Để sau|Later|Not now/i.test(x.textContent); }); if (!b) throw new Error('nút Để sau không có'); b.click(); await __mk.sleep(600); return 'basemap sheet dismissed'; })()"
    },
    {
     "eval": "(function(){ var e = document.getElementById('mp-result'); if (!e) throw new Error('#mp-result không có'); if (!e.querySelector('.mp-trip')) throw new Error('nút Bắt đầu đi (.mp-trip) không có'); e.scrollIntoView({ block: 'start' }); return 'scrolled'; })()"
    },
    {
     "wait": 500
    },
    {
     "tiles": true,
     "optional": true
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 245,
    "bottomLum": 253
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-map-nearest",
   "device": "phone",
   "url": "/index.html?demo=1#/map?tab=med&snap=half",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.02",
   "caption": {
    "vi": "Cơ sở y tế đã xác thực gần nhất",
    "en": "Nearest verified medical facilities"
   },
   "actions": [
    {
     "wait": 2500
    },
    {
     "eval": "(function(){ var e = document.getElementById('mp-med-filter'); if (!e) throw new Error('#mp-med-filter không có'); e.scrollIntoView({ block: 'start' }); return 'scrolled'; })()"
    },
    {
     "wait": 500
    },
    {
     "tiles": true
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 245,
    "bottomLum": 253
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-qr-owner",
   "device": "phone",
   "url": "/index.html?demo=1#/qr",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.03",
   "caption": {
    "vi": "Hồ sơ QR 2 lớp, mã hoá trên máy",
    "en": "Two-layer QR profile, encrypted on device"
   },
   "actions": [
    {
     "wait": 800
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 245,
    "bottomLum": 254
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-qr-rescuer",
   "device": "phone",
   "url": "/index.html?demo=1#/qr?view=rescuer",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.03",
   "caption": {
    "vi": "Chế độ người cứu hộ",
    "en": "Rescuer view"
   },
   "actions": [
    {
     "wait": 900
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 255,
    "bottomLum": 171
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-buddy-active",
   "device": "phone",
   "url": "/index.html?demo=1#/settings",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.04",
   "caption": {
    "vi": "Buddy đang theo dõi — đếm ngược check-in",
    "en": "Buddy active — check-in countdown"
   },
   "actions": [
    {
     "eval": "(async function(){ if (!(window.NC && NC.data && NC.data.buddy)) throw new Error('NC.data.buddy chưa có'); if (NC.data.init) await NC.data.init(); var cur = await NC.data.buddy.current(); if (!cur || cur.status === 'closed') { await NC.data.buddy.start({ traveler_name: 'Minh Anh', recipient: { name: 'Lê Hà', phone: '+84 000 000 001' }, interval_min: 60, grace_min: 30, route_id: 'ha-giang-loop', travel_mode: 'motorbike', share_public_medical: false, public_medical: null }); } var p = NC.settings.get('last_position'); try { await NC.data.buddy.checkin(p ? { kind: 'location', lat: p.lat, lng: p.lng, accuracy_m: 12 } : { kind: 'checkin' }); } catch (e) {} return 'buddy ' + ((await NC.data.buddy.current()) || {}).status; })()"
    },
    {
     "wait": 600
    },
    {
     "go": "buddy"
    },
    {
     "wait": 1200
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 245,
    "bottomLum": 254
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-buddy-setup",
   "device": "phone",
   "url": "/index.html?demo=1#/buddy",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.04",
   "caption": {
    "vi": "Thiết lập Buddy: bắt buộc số di động, email tuỳ chọn",
    "en": "Buddy setup: mobile number required, email optional"
   },
   "actions": [
    {
     "waitFor": "#bd-f-rphone",
     "timeout": 8000
    },
    {
     "wait": 500
    },
    {
     "eval": "(async function(){ var p = document.getElementById('bd-f-rphone'), e = document.getElementById('bd-f-remail'); if (!p || !e) throw new Error('#bd-f-rphone / #bd-f-remail không có'); await __mk.waitFor(function () { return p.value; }, 3000).catch(function () {}); if (e.value) { e.value = ''; ['input', 'change'].forEach(function (t) { e.dispatchEvent(new Event(t, { bubbles: true })); }); } return 'phone ' + p.value + ', email ' + (e.value || '(empty)'); })()"
    },
    {
     "wait": 400
    },
    {
     "scrollTo": {
      "sel": "#bd-form .bd-fieldset"
     },
     "block": "start"
    },
    {
     "eval": "(async function(){ window.scrollBy(0, 24); await __mk.sleep(160); window.scrollBy(0, -24); await __mk.sleep(350); return document.documentElement.classList.contains('nc-tabbar-hidden') ? 'tab bar still hidden' : 'tab bar shown'; })()",
     "optional": true
    },
    {
     "eval": "(function(){ var a = document.activeElement; if (a && a !== document.body && a.blur) { a.blur(); return 'blur ' + a.tagName; } return 'no focus'; })()"
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 244,
    "bottomLum": 254
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-buddy-sim",
   "device": "phone",
   "url": "/index.html?demo=1#/settings",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.04",
   "caption": {
    "vi": "Mô phỏng hành trình — sắp vào vùng mất sóng",
    "en": "Journey simulator — approaching a dead zone"
   },
   "actions": [
    {
     "eval": "(async function(){ if (!(window.NC && NC.data && NC.data.buddy)) throw new Error('NC.data.buddy chưa có'); if (NC.data.init) await NC.data.init(); var cur = await NC.data.buddy.current(); if (!cur || cur.status === 'closed') { await NC.data.buddy.start({ traveler_name: 'Minh Anh', recipient: { name: 'Lê Hà', phone: '+84 000 000 001' }, interval_min: 60, grace_min: 30, route_id: 'ha-giang-loop', travel_mode: 'motorbike', share_public_medical: false, public_medical: null }); } var p = NC.settings.get('last_position'); try { await NC.data.buddy.checkin(p ? { kind: 'location', lat: p.lat, lng: p.lng, accuracy_m: 12 } : { kind: 'checkin' }); } catch (e) {} return 'buddy ' + ((await NC.data.buddy.current()) || {}).status; })()"
    },
    {
     "wait": 600
    },
    {
     "go": "buddy"
    },
    {
     "wait": 1200
    },
    {
     "eval": "(function(){ if (!(NC.buddy && NC.buddy.openDemo)) throw new Error('NC.buddy.openDemo chưa có'); NC.buddy.openDemo(); return 'demo open ' + document.getElementById('bd-demo').open; })()"
    },
    {
     "wait": 500
    },
    {
     "scrollTo": {
      "sel": "#bd-s-play"
     },
     "block": "start"
    },
    {
     "eval": "(async function(){ window.scrollBy(0, 24); await __mk.sleep(160); window.scrollBy(0, -24); await __mk.sleep(350); return document.documentElement.classList.contains('nc-tabbar-hidden') ? 'tab bar still hidden' : 'tab bar shown'; })()",
     "optional": true
    },
    {
     "eval": "(function(){ var s = NC.buddy && NC.buddy.sim; if (!s) throw new Error('NC.buddy.sim chưa có'); s.setSpeed(60); s.seek(16); s.play(); return s.state ? JSON.stringify(s.state()).slice(0, 80) : 'play'; })()"
    },
    {
     "wait": 2600
    },
    {
     "tiles": true,
     "optional": true
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 245,
    "bottomLum": 253
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-buddy-alert",
   "device": "phone",
   "url": "/index.html?demo=1#/settings",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.04",
   "caption": {
    "vi": "Sắp vào vùng mất sóng — gửi toạ độ cho người thân?",
    "en": "Dead zone ahead — send your location to your contact?"
   },
   "actions": [
    {
     "eval": "(async function(){ if (!(window.NC && NC.data && NC.data.buddy)) throw new Error('NC.data.buddy chưa có'); if (NC.data.init) await NC.data.init(); var cur = await NC.data.buddy.current(); if (!cur || cur.status === 'closed') { await NC.data.buddy.start({ traveler_name: 'Minh Anh', recipient: { name: 'Lê Hà', phone: '+84 000 000 001' }, interval_min: 60, grace_min: 30, route_id: 'ha-giang-loop', travel_mode: 'motorbike', share_public_medical: false, public_medical: null }); } var p = NC.settings.get('last_position'); try { await NC.data.buddy.checkin(p ? { kind: 'location', lat: p.lat, lng: p.lng, accuracy_m: 12 } : { kind: 'checkin' }); } catch (e) {} return 'buddy ' + ((await NC.data.buddy.current()) || {}).status; })()"
    },
    {
     "wait": 600
    },
    {
     "go": "buddy"
    },
    {
     "wait": 1200
    },
    {
     "eval": "(function(){ if (!(NC.buddy && NC.buddy.demoAlert)) throw new Error('NC.buddy.demoAlert chưa có'); var p = NC.buddy.demoAlert(); if (p && p.catch) p.catch(function () {}); return 'demo alert opened'; })()"
    },
    {
     "waitFor": ".tw-pop-modal.is-open",
     "timeout": 6000
    },
    {
     "wait": 700
    },
    {
     "eval": "(function(){ var a = document.activeElement; if (a && a !== document.body && a.blur) { a.blur(); return 'blur ' + a.tagName; } return 'no focus'; })()"
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "light",
    "bottom": "light",
    "topLum": 141,
    "bottomLum": 146
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-fa-library",
   "device": "phone",
   "url": "/index.html?demo=1#/firstaid",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.05",
   "caption": {
    "vi": "Thư viện sơ cứu ngoại tuyến",
    "en": "Offline first-aid library"
   },
   "actions": [
    {
     "wait": 800
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 245,
    "bottomLum": 254
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-fa-step",
   "device": "phone",
   "url": "/index.html?demo=1#/firstaid?item=bleeding&step=2",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.05",
   "caption": {
    "vi": "Hướng dẫn từng bước có minh hoạ",
    "en": "Illustrated step-by-step guide"
   },
   "actions": [
    {
     "wait": 900
    },
    {
     "scrollTo": {
      "sel": "#screen-firstaid .fa-steps__head"
     },
     "block": "start"
    },
    {
     "wait": 500
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 232,
    "bottomLum": 225
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-emergency",
   "device": "phone",
   "url": "/index.html?demo=1#/settings",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "Khẩn cấp",
   "caption": {
    "vi": "Nút khẩn cấp: 115, SOS, hồ sơ y tế",
    "en": "Emergency sheet: 115, SOS, medical ID"
   },
   "actions": [
    {
     "eval": "(async function(){ if (!(window.NC && NC.data && NC.data.buddy)) throw new Error('NC.data.buddy chưa có'); if (NC.data.init) await NC.data.init(); var cur = await NC.data.buddy.current(); if (!cur || cur.status === 'closed') { await NC.data.buddy.start({ traveler_name: 'Minh Anh', recipient: { name: 'Lê Hà', phone: '+84 000 000 001' }, interval_min: 60, grace_min: 30, route_id: 'ha-giang-loop', travel_mode: 'motorbike', share_public_medical: false, public_medical: null }); } var p = NC.settings.get('last_position'); try { await NC.data.buddy.checkin(p ? { kind: 'location', lat: p.lat, lng: p.lng, accuracy_m: 12 } : { kind: 'checkin' }); } catch (e) {} return 'buddy ' + ((await NC.data.buddy.current()) || {}).status; })()"
    },
    {
     "wait": 600
    },
    {
     "go": "home"
    },
    {
     "wait": 900
    },
    {
     "click": "#fab-emergency"
    },
    {
     "wait": 900
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "light",
    "bottom": "dark",
    "topLum": 141,
    "bottomLum": 255
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-settings-privacy",
   "device": "phone",
   "url": "/index.html?demo=1#/settings?section=privacy",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "Cài đặt",
   "caption": {
    "vi": "Quyền riêng tư — xoá dữ liệu 1 chạm",
    "en": "Privacy — one-tap data wipe"
   },
   "actions": [
    {
     "wait": 1000
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 237,
    "bottomLum": 232
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-home-dark",
   "device": "phone",
   "url": "/index.html?demo=1&theme=dark#/settings",
   "theme": "dark",
   "lang": "vi",
   "offline": false,
   "module": "Trang chủ",
   "caption": {
    "vi": "Trang chủ — chế độ tối",
    "en": "Home — dark mode"
   },
   "actions": [
    {
     "eval": "(async function(){ await NC.data.init(); var r = NC.settings.get('route_id') || 'ha-giang-loop', c = NC.settings.get('carrier') || 'viettel'; var have = await NC.data.listDownloadedPacks(); if (!have.some(function (x) { return x.route_id === r && x.carrier === c; })) await NC.data.downloadPack(r, c); return 'pack ' + r + ':' + c + ' → ' + (await NC.data.listDownloadedPacks()).length; })()"
    },
    {
     "eval": "(async function(){ if (!(window.NC && NC.data && NC.data.buddy)) throw new Error('NC.data.buddy chưa có'); if (NC.data.init) await NC.data.init(); var cur = await NC.data.buddy.current(); if (!cur || cur.status === 'closed') { await NC.data.buddy.start({ traveler_name: 'Minh Anh', recipient: { name: 'Lê Hà', phone: '+84 000 000 001' }, interval_min: 60, grace_min: 30, route_id: 'ha-giang-loop', travel_mode: 'motorbike', share_public_medical: false, public_medical: null }); } var p = NC.settings.get('last_position'); try { await NC.data.buddy.checkin(p ? { kind: 'location', lat: p.lat, lng: p.lng, accuracy_m: 12 } : { kind: 'checkin' }); } catch (e) {} return 'buddy ' + ((await NC.data.buddy.current()) || {}).status; })()"
    },
    {
     "wait": 600
    },
    {
     "go": "home"
    },
    {
     "wait": 1400
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "light",
    "bottom": "light",
    "topLum": 21,
    "bottomLum": 30
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-map-dark",
   "device": "phone",
   "url": "/index.html?demo=1&theme=dark#/map?from=hg-meo-vac&to=hg-ha-giang&strategy=shortest&tab=route&snap=half",
   "theme": "dark",
   "lang": "vi",
   "offline": false,
   "module": "MOD.02",
   "caption": {
    "vi": "Bản đồ nền tối, lớp sóng offline",
    "en": "Dark basemap, offline signal layer"
   },
   "actions": [
    {
     "wait": 2500
    },
    {
     "eval": "(async function(){ try { await __mk.waitFor('.mk-bm-sug.is-open', 3500); } catch (e) { return 'no basemap sheet'; } var s = document.querySelector('.mk-bm-sug.is-open'); var b = Array.prototype.find.call(s.querySelectorAll('button'), function (x) { return /Để sau|Later|Not now/i.test(x.textContent); }); if (!b) throw new Error('nút Để sau không có'); b.click(); await __mk.sleep(600); return 'basemap sheet dismissed'; })()"
    },
    {
     "eval": "(function(){ var e = document.getElementById('mp-result'); if (!e) throw new Error('#mp-result không có'); e.scrollIntoView({ block: 'start' }); return 'scrolled'; })()"
    },
    {
     "wait": 500
    },
    {
     "tiles": true
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "light",
    "bottom": "light",
    "topLum": 21,
    "bottomLum": 32
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-tr-result-dark",
   "device": "phone",
   "url": "/index.html?demo=1&theme=dark#/translate",
   "theme": "dark",
   "lang": "vi",
   "offline": false,
   "module": "MOD.01",
   "caption": {
    "vi": "Câu khẩn cấp + nút Gọi 115",
    "en": "Urgent phrase + Call 115"
   },
   "actions": [
    {
     "click": "#screen-translate [data-tr-act='group'][data-id='arms']"
    },
    {
     "wait": 600
    },
    {
     "click": "#screen-translate [data-tr-act='child'][data-id='arm-fracture']"
    },
    {
     "wait": 600
    },
    {
     "click": "#screen-translate [data-tr-act='sev'][data-id='severe']"
    },
    {
     "wait": 900
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "light",
    "bottom": "light",
    "topLum": 21,
    "bottomLum": 30
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-qr-owner-dark",
   "device": "phone",
   "url": "/index.html?demo=1&theme=dark#/qr",
   "theme": "dark",
   "lang": "vi",
   "offline": false,
   "module": "MOD.03",
   "caption": {
    "vi": "Hồ sơ QR — chế độ tối",
    "en": "QR profile — dark mode"
   },
   "actions": [
    {
     "wait": 800
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "light",
    "bottom": "light",
    "topLum": 21,
    "bottomLum": 30
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-buddy-dark",
   "device": "phone",
   "url": "/index.html?demo=1&theme=dark#/settings",
   "theme": "dark",
   "lang": "vi",
   "offline": false,
   "module": "MOD.04",
   "caption": {
    "vi": "Buddy Check-in — chế độ tối",
    "en": "Buddy check-in — dark mode"
   },
   "actions": [
    {
     "eval": "(async function(){ if (!(window.NC && NC.data && NC.data.buddy)) throw new Error('NC.data.buddy chưa có'); if (NC.data.init) await NC.data.init(); var cur = await NC.data.buddy.current(); if (!cur || cur.status === 'closed') { await NC.data.buddy.start({ traveler_name: 'Minh Anh', recipient: { name: 'Lê Hà', phone: '+84 000 000 001' }, interval_min: 60, grace_min: 30, route_id: 'ha-giang-loop', travel_mode: 'motorbike', share_public_medical: false, public_medical: null }); } var p = NC.settings.get('last_position'); try { await NC.data.buddy.checkin(p ? { kind: 'location', lat: p.lat, lng: p.lng, accuracy_m: 12 } : { kind: 'checkin' }); } catch (e) {} return 'buddy ' + ((await NC.data.buddy.current()) || {}).status; })()"
    },
    {
     "wait": 600
    },
    {
     "go": "buddy"
    },
    {
     "wait": 1200
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "light",
    "bottom": "light",
    "topLum": 21,
    "bottomLum": 31
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-fa-cpr-dark",
   "device": "phone",
   "url": "/index.html?demo=1&theme=dark#/firstaid?item=cpr&tool=cpr",
   "theme": "dark",
   "lang": "vi",
   "offline": false,
   "module": "MOD.05",
   "caption": {
    "vi": "CPR: đếm nhịp ép tim 110 lần/phút",
    "en": "CPR compression counter, 110/min"
   },
   "actions": [
    {
     "wait": 900
    },
    {
     "eval": "(function(){ var m = NC.firstaid && NC.firstaid.metronome; if (m && m.start) { m.start(); return 'metronome'; } return 'no metronome'; })()",
     "optional": true
    },
    {
     "eval": "(function(){ var a = document.activeElement; if (a && a !== document.body && a.blur) { a.blur(); return 'blur ' + a.tagName; } return 'no focus'; })()"
    },
    {
     "eval": "(async function(){ window.scrollBy(0, 24); await __mk.sleep(160); window.scrollBy(0, -24); await __mk.sleep(350); return document.documentElement.classList.contains('nc-tabbar-hidden') ? 'tab bar still hidden' : 'tab bar shown'; })()",
     "optional": true
    },
    {
     "wait": 2400
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "light",
    "bottom": "light",
    "topLum": 35,
    "bottomLum": 31
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "p-emergency-dark",
   "device": "phone",
   "url": "/index.html?demo=1&theme=dark#/settings",
   "theme": "dark",
   "lang": "vi",
   "offline": false,
   "module": "Khẩn cấp",
   "caption": {
    "vi": "Nút khẩn cấp — chế độ tối",
    "en": "Emergency sheet — dark mode"
   },
   "actions": [
    {
     "eval": "(async function(){ if (!(window.NC && NC.data && NC.data.buddy)) throw new Error('NC.data.buddy chưa có'); if (NC.data.init) await NC.data.init(); var cur = await NC.data.buddy.current(); if (!cur || cur.status === 'closed') { await NC.data.buddy.start({ traveler_name: 'Minh Anh', recipient: { name: 'Lê Hà', phone: '+84 000 000 001' }, interval_min: 60, grace_min: 30, route_id: 'ha-giang-loop', travel_mode: 'motorbike', share_public_medical: false, public_medical: null }); } var p = NC.settings.get('last_position'); try { await NC.data.buddy.checkin(p ? { kind: 'location', lat: p.lat, lng: p.lng, accuracy_m: 12 } : { kind: 'checkin' }); } catch (e) {} return 'buddy ' + ((await NC.data.buddy.current()) || {}).status; })()"
    },
    {
     "wait": 600
    },
    {
     "go": "home"
    },
    {
     "wait": 900
    },
    {
     "click": "#fab-emergency"
    },
    {
     "wait": 900
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "light",
    "bottom": "light",
    "topLum": 8,
    "bottomLum": 29
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "t-home",
   "device": "tablet",
   "url": "/index.html?demo=1#/settings",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "Trang chủ",
   "caption": {
    "vi": "Trang chủ 2 cột + thanh điều hướng dạng rail",
    "en": "Two-column home + navigation rail"
   },
   "actions": [
    {
     "eval": "(async function(){ await NC.data.init(); var r = NC.settings.get('route_id') || 'ha-giang-loop', c = NC.settings.get('carrier') || 'viettel'; var have = await NC.data.listDownloadedPacks(); if (!have.some(function (x) { return x.route_id === r && x.carrier === c; })) await NC.data.downloadPack(r, c); return 'pack ' + r + ':' + c + ' → ' + (await NC.data.listDownloadedPacks()).length; })()"
    },
    {
     "eval": "(async function(){ if (!(window.NC && NC.data && NC.data.buddy)) throw new Error('NC.data.buddy chưa có'); if (NC.data.init) await NC.data.init(); var cur = await NC.data.buddy.current(); if (!cur || cur.status === 'closed') { await NC.data.buddy.start({ traveler_name: 'Minh Anh', recipient: { name: 'Lê Hà', phone: '+84 000 000 001' }, interval_min: 60, grace_min: 30, route_id: 'ha-giang-loop', travel_mode: 'motorbike', share_public_medical: false, public_medical: null }); } var p = NC.settings.get('last_position'); try { await NC.data.buddy.checkin(p ? { kind: 'location', lat: p.lat, lng: p.lng, accuracy_m: 12 } : { kind: 'checkin' }); } catch (e) {} return 'buddy ' + ((await NC.data.buddy.current()) || {}).status; })()"
    },
    {
     "wait": 600
    },
    {
     "go": "home"
    },
    {
     "wait": 1400
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 246,
    "bottomLum": 243
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "t-map",
   "device": "tablet",
   "url": "/index.html?demo=1#/map?from=hg-meo-vac&to=hg-ha-giang&strategy=shortest&tab=route&snap=half",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.02",
   "caption": {
    "vi": "Bản đồ + bảng lộ trình bên cạnh",
    "en": "Map + side route panel"
   },
   "actions": [
    {
     "wait": 2500
    },
    {
     "eval": "(async function(){ try { await __mk.waitFor('.mk-bm-sug.is-open', 3500); } catch (e) { return 'no basemap sheet'; } var s = document.querySelector('.mk-bm-sug.is-open'); var b = Array.prototype.find.call(s.querySelectorAll('button'), function (x) { return /Để sau|Later|Not now/i.test(x.textContent); }); if (!b) throw new Error('nút Để sau không có'); b.click(); await __mk.sleep(600); return 'basemap sheet dismissed'; })()"
    },
    {
     "tiles": true
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 246,
    "bottomLum": 227
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "t-translate",
   "device": "tablet",
   "url": "/index.html?demo=1&offline=1#/translate",
   "theme": "light",
   "lang": "vi",
   "offline": true,
   "module": "MOD.01",
   "caption": {
    "vi": "Kết quả song ngữ chữ lớn, “Xem thêm” mở chi tiết câu",
    "en": "Large bilingual result, “More” opens phrase details"
   },
   "actions": [
    {
     "click": "#screen-translate [data-tr-act='group'][data-id='legs']"
    },
    {
     "wait": 600
    },
    {
     "click": "#screen-translate [data-tr-act='symptom'][data-id='leg-exhaust-burn']"
    },
    {
     "wait": 600
    },
    {
     "click": "#screen-translate [data-tr-act='sev'][data-id='severe']"
    },
    {
     "wait": 900
    },
    {
     "click": "#screen-translate .tr-result__more > summary"
    },
    {
     "wait": 600
    },
    {
     "eval": "(function(){ var a = document.activeElement; if (a && a !== document.body && a.blur) { a.blur(); return 'blur ' + a.tagName; } return 'no focus'; })()"
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 246,
    "bottomLum": 210
   },
   "taps": [],
   "safeApplied": true,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "d-home",
   "device": "desktop",
   "url": "/index.html?demo=1#/settings",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "Trang chủ",
   "caption": {
    "vi": "Trang chủ trên máy tính — sidebar đầy đủ",
    "en": "Desktop home — full sidebar"
   },
   "actions": [
    {
     "eval": "(async function(){ await NC.data.init(); var r = NC.settings.get('route_id') || 'ha-giang-loop', c = NC.settings.get('carrier') || 'viettel'; var have = await NC.data.listDownloadedPacks(); if (!have.some(function (x) { return x.route_id === r && x.carrier === c; })) await NC.data.downloadPack(r, c); return 'pack ' + r + ':' + c + ' → ' + (await NC.data.listDownloadedPacks()).length; })()"
    },
    {
     "eval": "(async function(){ if (!(window.NC && NC.data && NC.data.buddy)) throw new Error('NC.data.buddy chưa có'); if (NC.data.init) await NC.data.init(); var cur = await NC.data.buddy.current(); if (!cur || cur.status === 'closed') { await NC.data.buddy.start({ traveler_name: 'Minh Anh', recipient: { name: 'Lê Hà', phone: '+84 000 000 001' }, interval_min: 60, grace_min: 30, route_id: 'ha-giang-loop', travel_mode: 'motorbike', share_public_medical: false, public_medical: null }); } var p = NC.settings.get('last_position'); try { await NC.data.buddy.checkin(p ? { kind: 'location', lat: p.lat, lng: p.lng, accuracy_m: 12 } : { kind: 'checkin' }); } catch (e) {} return 'buddy ' + ((await NC.data.buddy.current()) || {}).status; })()"
    },
    {
     "wait": 600
    },
    {
     "go": "home"
    },
    {
     "wait": 1400
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 248,
    "bottomLum": 242
   },
   "taps": [],
   "safeApplied": false,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "d-map",
   "device": "desktop",
   "url": "/index.html?demo=1#/map?from=hg-meo-vac&to=hg-ha-giang&strategy=shortest&tab=route&snap=half",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.02",
   "caption": {
    "vi": "Bản đồ & định tuyến offline",
    "en": "Offline map & routing"
   },
   "actions": [
    {
     "wait": 2500
    },
    {
     "eval": "(async function(){ try { await __mk.waitFor('.mk-bm-sug.is-open', 3500); } catch (e) { return 'no basemap sheet'; } var s = document.querySelector('.mk-bm-sug.is-open'); var b = Array.prototype.find.call(s.querySelectorAll('button'), function (x) { return /Để sau|Later|Not now/i.test(x.textContent); }); if (!b) throw new Error('nút Để sau không có'); b.click(); await __mk.sleep(600); return 'basemap sheet dismissed'; })()"
    },
    {
     "tiles": true
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 247,
    "bottomLum": 228
   },
   "taps": [],
   "safeApplied": false,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "d-nav-collapsed",
   "device": "desktop",
   "url": "/index.html?demo=1#/map?from=hg-meo-vac&to=hg-ha-giang&strategy=shortest&tab=route",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.02",
   "caption": {
    "vi": "Sidebar thu gọn thành thanh biểu tượng — bản đồ rộng hơn",
    "en": "Sidebar collapsed to an icon rail — more room for the map"
   },
   "actions": [
    {
     "wait": 1500
    },
    {
     "eval": "(function(){ if (!(NC.app && NC.app.setNavCollapsed)) throw new Error('NC.app.setNavCollapsed chưa có'); NC.app.setNavCollapsed(true); return JSON.stringify(NC.app.nav ? NC.app.nav() : {}); })()"
    },
    {
     "wait": 1000
    },
    {
     "eval": "(async function(){ try { await __mk.waitFor('.mk-bm-sug.is-open', 3500); } catch (e) { return 'no basemap sheet'; } var s = document.querySelector('.mk-bm-sug.is-open'); var b = Array.prototype.find.call(s.querySelectorAll('button'), function (x) { return /Để sau|Later|Not now/i.test(x.textContent); }); if (!b) throw new Error('nút Để sau không có'); b.click(); await __mk.sleep(600); return 'basemap sheet dismissed'; })()"
    },
    {
     "tiles": true
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 245,
    "bottomLum": 233
   },
   "taps": [],
   "safeApplied": false,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "d-buddy",
   "device": "desktop",
   "url": "/index.html?demo=1#/settings",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "MOD.04",
   "caption": {
    "vi": "Buddy Check-in trên web: đếm ngược và vùng mất sóng kế tiếp",
    "en": "Buddy check-in on the web: countdown and next dead zone"
   },
   "actions": [
    {
     "eval": "(async function(){ if (!(window.NC && NC.data && NC.data.buddy)) throw new Error('NC.data.buddy chưa có'); if (NC.data.init) await NC.data.init(); var cur = await NC.data.buddy.current(); if (!cur || cur.status === 'closed') { await NC.data.buddy.start({ traveler_name: 'Minh Anh', recipient: { name: 'Lê Hà', phone: '+84 000 000 001' }, interval_min: 60, grace_min: 30, route_id: 'ha-giang-loop', travel_mode: 'motorbike', share_public_medical: false, public_medical: null }); } var p = NC.settings.get('last_position'); try { await NC.data.buddy.checkin(p ? { kind: 'location', lat: p.lat, lng: p.lng, accuracy_m: 12 } : { kind: 'checkin' }); } catch (e) {} return 'buddy ' + ((await NC.data.buddy.current()) || {}).status; })()"
    },
    {
     "wait": 600
    },
    {
     "go": "buddy"
    },
    {
     "wait": 1600
    },
    {
     "tiles": true,
     "optional": true
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 247,
    "bottomLum": 244
   },
   "taps": [],
   "safeApplied": false,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "a-overview",
   "device": "desktop",
   "url": "/admin.html?backend=local",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "Admin",
   "caption": {
    "vi": "Dashboard: KPI, điểm y tế đã xác thực",
    "en": "Dashboard: KPIs & verified facilities"
   },
   "actions": [
    {
     "waitFor": "#ad-demo",
     "timeout": 10000
    },
    {
     "click": "#ad-demo"
    },
    {
     "wait": 1500
    },
    {
     "waitFor": "#ad-page-overview",
     "timeout": 8000,
     "optional": true
    },
    {
     "wait": 1200
    },
    {
     "tiles": true,
     "optional": true
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 244,
    "bottomLum": 234
   },
   "taps": [],
   "safeApplied": false,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "a-buddy",
   "device": "desktop",
   "url": "/admin.html?backend=local",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "Admin",
   "caption": {
    "vi": "Giám sát Buddy — quá hạn lên đầu",
    "en": "Buddy monitor — overdue first"
   },
   "actions": [
    {
     "waitFor": "#ad-demo",
     "timeout": 10000
    },
    {
     "click": "#ad-demo"
    },
    {
     "wait": 1500
    },
    {
     "waitFor": "#ad-page-overview",
     "timeout": 8000,
     "optional": true
    },
    {
     "hash": "#/buddy"
    },
    {
     "wait": 1800
    },
    {
     "tiles": true,
     "optional": true
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 244,
    "bottomLum": 245
   },
   "taps": [],
   "safeApplied": false,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  },
  {
   "id": "a-signal",
   "device": "desktop",
   "url": "/admin.html?backend=local",
   "theme": "light",
   "lang": "vi",
   "offline": false,
   "module": "Admin",
   "caption": {
    "vi": "Bản đồ nhiệt sóng theo nhà mạng",
    "en": "Signal heat map per carrier"
   },
   "actions": [
    {
     "waitFor": "#ad-demo",
     "timeout": 10000
    },
    {
     "click": "#ad-demo"
    },
    {
     "wait": 1500
    },
    {
     "waitFor": "#ad-page-overview",
     "timeout": 8000,
     "optional": true
    },
    {
     "hash": "#/signal"
    },
    {
     "wait": 2000
    },
    {
     "tiles": true,
     "optional": true
    }
   ],
   "live": null,
   "exists": true,
   "thumb": true,
   "placeholder": false,
   "v": 1790926249487,
   "tone": {
    "top": "dark",
    "bottom": "dark",
    "topLum": 245,
    "bottomLum": 233
   },
   "taps": [],
   "safeApplied": false,
   "lastRun": {
    "ok": true,
    "at": "2026-10-02T07:30:49.487Z",
    "error": null
   }
  }
 ]
};
