# نشر قضيتي على خادم Proxmox

دليل خطوة بخطوة لتشغيل الموقع على `https://qadiyati.ps` من لابتوب عليه Proxmox.

```
الزائر ──https──▶ Cloudflare ──نفق مشفّر──▶ cloudflared ─▶ nginx (127.0.0.1:8080) ─┬─▶ الواجهة (ملفات ثابتة)
                (DNS + HTTPS)                         (على الخادم نفسه)             └─▶ /api ─▶ Node (127.0.0.1:3000) ─▶ PostgreSQL
البريد: Node ──▶ Resend ──▶ صندوق المستلم
```

- **لا تفتح أي منفذ على الراوتر.** الخادم يتصل بـ Cloudflare من الداخل، وعنوان بيتك يبقى مخفياً.
- **HTTPS مجاني وتلقائي** من Cloudflare.
- **البريد يبقى عبر Resend**: خادم بريد في البيت ستُرفض رسائله أو تذهب للرسائل المزعجة.

## محتويات هذا المجلد

| الملف | ما هو |
|---|---|
| `upload.ps1` | يحزم المشروع على جهازك (ويندوز) ويرفعه ويثبّته على الخادم بأمر واحد |
| `scripts/setup-server.sh` | تجهيز الخادم أول مرة: nginx وPostgreSQL وNode وcloudflared وقاعدة البيانات وملف `.env` |
| `scripts/deploy.sh` | تثبيت نسخة جديدة وإعادة التشغيل (يحفظ `.env` والمستندات وقاعدة البيانات) |
| `scripts/backup.sh` | نسخة احتياطية ليلية لقاعدة البيانات والمستندات (آخر 14 يوماً) |
| `nginx/qadiyati.conf` | إعداد nginx |
| `systemd/qadiyati-api.service` | يُبقي الخادم الخلفي يعمل ويعيد تشغيله عند التوقف أو بعد إعادة التشغيل |
| `cloudflared/config.yml` | إعداد نفق Cloudflare |
| `env/backend.env.production.example` | قالب إعدادات الإنتاج للخادم الخلفي |
| `env/frontend.env.production` | إعدادات بناء الواجهة للإنتاج |

---

## 1. إنشاء جهاز Ubuntu على Proxmox

1. من واجهة Proxmox (`https://عنوان-اللابتوب:8006`) نزّل قالب أو صورة **Ubuntu Server 24.04 LTS**:
   - **حاوية LXC (أخف، موصى بها):** `local` ← **CT Templates** ← **Templates** ← `ubuntu-24.04-standard`.
   - أو **جهاز افتراضي VM:** ارفع ملف ISO لـ Ubuntu Server 24.04 إلى `local` ← **ISO Images**.
2. أنشئ الجهاز بهذه الموارد كحد أدنى: **2 أنوية، 4 GB ذاكرة، 40 GB قرص**.
   - في LXC: اترك **Unprivileged container** مفعّلاً، وفعّل **Nesting** من **Options** ← **Features**.
3. فعّل **Start at boot** من **Options** حتى يعمل الموقع تلقائياً بعد انقطاع الكهرباء.
4. أعطه **عنواناً ثابتاً** على شبكة البيت: إما من إعدادات الشبكة عند الإنشاء (مثل `192.168.1.50/24`)، أو بحجز عنوان له في الراوتر (DHCP reservation).
5. ادخل إليه من جهازك بـ SSH وحدّثه:
   ```bash
   ssh ubuntu@192.168.1.50        # في LXC يكون المستخدم root
   sudo apt update && sudo apt upgrade -y
   ```
   في حاوية LXC أنشئ مستخدماً عادياً للعمل بدل root: `adduser ubuntu && usermod -aG sudo ubuntu`.

> **لابتوب كخادم:** من إعدادات BIOS فعّل **Restore on AC power loss / Power on after power failure** إن وُجد، واتركه موصولاً بالشاحن. يفضَّل UPS صغير. سكربت التجهيز يمنع النوم عند إغلاق الغطاء.

## 2. التثبيت (أمر واحد من جهازك)

من مجلد المشروع على ويندوز، في PowerShell:

```powershell
.\deploy\upload.ps1 -Server 192.168.1.50 -User ubuntu
```

ماذا يحدث:
1. يُحزم المشروع **بدون** `node_modules` و`.env` والمستندات المرفوعة. أسرارك وبياناتك المحلية لا تُرفع.
2. يُرفع إلى الخادم.
3. **أول مرة فقط** يُشغَّل `setup-server.sh`: يثبّت البرامج، وينشئ قاعدة بيانات `qadiyati` بمستخدم خاص بها (ليس superuser)، ويكتب `/opt/qadiyati/backend/.env` بكلمة مرور قاعدة بيانات وسرّ مصادقة **مولَّدين عشوائياً**.
4. يُشغَّل `deploy.sh`: تثبيت الحزم، بناء الواجهة، إنشاء جداول قاعدة البيانات (أول مرة)، وتشغيل الخدمة.

سيطلب منك كلمة مرور `sudo` على الخادم.

## 3. إكمال الإعدادات على الخادم

```bash
sudo nano /opt/qadiyati/backend/.env
```

أكمل:
- `RESEND_API_KEY=` مفتاح Resend (يبدأ بـ `re_`). **اكتبه أنت مباشرة في الملف**، ولا ترسله لأحد.
- بيانات الدفع الحقيقية `PAYMENT_*` (الحساب البنكي، المحفظة، عنوان الدفع النقدي).
- (اختياري) مفتاح الذكاء الاصطناعي. مفتاح Gemini المجاني يسمح لـ Google باستخدام المحتوى، فلا تستعمله مع بيانات موكّلين حقيقية.

احفظ (`Ctrl+O` ثم `Enter` ثم `Ctrl+X`) وأعد التشغيل:

```bash
sudo systemctl restart qadiyati-api
sudo systemctl status qadiyati-api --no-pager
```

## 4. نقل الدومين إلى Cloudflare

1. أنشئ حساباً مجانياً في [dash.cloudflare.com](https://dash.cloudflare.com) ← **Add a domain** ← `qadiyati.ps` ← الخطة **Free**.
2. يعرض Cloudflare **اسمي خادمَي أسماء (nameservers)** مثل `xxx.ns.cloudflare.com`.
3. ادخل لوحة الجهة التي اشتريت منها `qadiyati.ps` (مسجّل نطاقات .ps) واستبدل خوادم الأسماء الحالية بخادمَي Cloudflare. إن لم تجد الخيار فاطلب ذلك من دعمهم.
4. انتظر حتى يصبح الدومين **Active** في Cloudflare (من دقائق إلى 24 ساعة؛ يصلك بريد).
5. من **SSL/TLS** ← **Overview** اختر **Full**.

## 5. سجلات Resend في Cloudflare

من **DNS** ← **Records** ← **Add record** أضف الأربعة كما هي حرفياً. **قبل الإضافة** تأكد من عدم وجود سجل بالاسم نفسه؛ إن وُجد فاحذفه أو عدّله:

| النوع | الاسم (Name) | القيمة | Proxy |
|---|---|---|---|
| TXT | `resend._domainkey` | قيمة `p=MIGf…` كاملة كما في Resend | — |
| CNAME | `send` | `send.forge.rmta.net` | **DNS only** (سحابة رمادية) |
| CNAME | `rsend` | `rsend-apne1.forge.rmta.net` | **DNS only** (سحابة رمادية) |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | — |

- سجلّا CNAME **يجب** أن يكونا **DNS only**، وإلا يفشل التحقق.
- إن كان للدومين سجل `_dmarc` قديم فاتركه واحداً فقط؛ لا يجوز وجود سجلَّي DMARC.
- انسخ قيمة DKIM من صفحة Resend مباشرة (زر النسخ) حتى لا يسقط منها حرف.

ثم ارجع إلى Resend ← **Domains** ← `qadiyati.ps` ← **Verify**. عندما يصبح **Verified** يبدأ البريد بالخروج من `no-reply@qadiyati.ps`.

## 6. نفق Cloudflare (نشر الموقع)

على الخادم:

```bash
sudo cloudflared tunnel login
```
يطبع رابطاً: افتحه في متصفحك، سجّل دخولك إلى Cloudflare واختر `qadiyati.ps`.

```bash
sudo cloudflared tunnel create qadiyati
```
يطبع **معرّف النفق (Tunnel ID)** وينشئ ملف `/root/.cloudflared/<ID>.json`. ثم:

```bash
ID=ضع-معرّف-النفق-هنا
sudo mkdir -p /etc/cloudflared
sudo cp /root/.cloudflared/$ID.json /etc/cloudflared/
sed "s/TUNNEL_ID/$ID/g" /opt/qadiyati/deploy/cloudflared/config.yml | sudo tee /etc/cloudflared/config.yml
sudo cloudflared tunnel route dns qadiyati qadiyati.ps
sudo cloudflared tunnel route dns qadiyati www.qadiyati.ps
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

افتح `https://qadiyati.ps` 🎉

## 6-ب. بديل مجاني بلا دومين: رابط trycloudflare + بريد Gmail

إن لم يكن لديك دومين، يعمل الموقع مجاناً على رابط مثل `https://كلمات-عشوائية.trycloudflare.com`، ويُرسل البريد من حساب Gmail.

**الرابط المجاني** (لا يحتاج حساب Cloudflare):
```bash
sudo cp /opt/qadiyati/deploy/scripts/quick-tunnel.sh /usr/local/bin/qadiyati-quick-tunnel
sudo chmod 755 /usr/local/bin/qadiyati-quick-tunnel
sudo cp /opt/qadiyati/deploy/systemd/qadiyati-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now qadiyati-tunnel
cat /opt/qadiyati/PUBLIC_URL      # الرابط الحالي
```
- **الرابط يتغيّر** عند كل إعادة تشغيل للخادم أو للخدمة. السكربت يحدّث إعدادات الموقع تلقائياً، لكن عليك قراءة الرابط الجديد بالأمر أعلاه وإرساله للمستخدمين.
- مناسب للعرض والتجربة ومناقشة مشروع التخرج، لا لتشغيل دائم. للتشغيل الدائم اشترِ دوميناً واتبع الخطوات 4–6.

**البريد عبر Gmail** (مجاني، حتى نحو 500 رسالة يومياً):
1. في حساب Google: **الأمان** ← فعّل **التحقق بخطوتين** ← ابحث عن **App passwords (كلمات مرور التطبيقات)** ← اسم `Qadiyati` ← **إنشاء**. يظهر رمز من 16 حرفاً.
2. أضف إلى `/opt/qadiyati/backend/.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=عنوانك@gmail.com
   SMTP_PASS=الرمز من 16 حرفاً بلا مسافات
   ```
3. `sudo systemctl restart qadiyati-api`

عند وجود إعدادات SMTP تُستعمل بدل Resend. المرسل يظهر بعنوان Gmail نفسه.

## 6-ج. رابط ثابت مجاني: Tailscale Funnel (المستعمل حالياً)

الموقع يعمل على **https://qadiyati.tail348ab8.ts.net**: رابط ثابت لا يتغيّر بإعادة التشغيل، مع HTTPS، ومجاني.

- يعمل عبر برنامج Tailscale داخل الحاوية (يبدأ تلقائياً مع الخادم) ويمرّر الزيارات إلى nginx.
- حالته: `tailscale funnel status`. إيقافه: `tailscale funnel --https=443 off`. تشغيله: `tailscale funnel --bg http://127.0.0.1:8080`
- في حساب Tailscale يلزم: **HTTPS Certificates** مفعّلة (صفحة DNS)، وفي **Access controls** صلاحية `funnel` في `nodeAttrs`.
- الحاوية تحتاج جهاز الشبكة `/dev/net/tun` (`pct set 100 --dev0 /dev/net/tun` على Proxmox).
- خدمة الرابط المتغيّر `qadiyati-tunnel` **معطّلة**؛ لا تفعّلها مع Funnel، لأنها تعيد كتابة عنوان الموقع في `.env`.

## 7. حساب مدير المنصّة

1. من الموقع سجّل حساباً بالبريد الذي تريده مديراً للمنصّة.
2. على الخادم:
   ```bash
   cd /opt/qadiyati/backend
   sudo -u qadiyati npm run platform-admin:grant -- --email=بريدك@example.com
   ```
3. ادخل من «صاحب مكتب» بذلك البريد لتصل إلى «طلبات المكاتب» و«الاشتراكات» و«رسائل الدعم».

## 8. التحديثات

بعد أي تعديل على المشروع، من جهازك:

```powershell
.\deploy\upload.ps1 -Server 192.168.1.50 -User ubuntu
```

يُستبدل الكود ويُعاد البناء والتشغيل، ويبقى `.env` والمستندات وقاعدة البيانات كما هي.

**تعديلات قاعدة البيانات:** التثبيت الأول ينشئ الجداول بآخر شكل (من `schema.sql`)، فلا تحتاج ملفات الترحيل الحالية (0001–0007). إذا أُضيف لاحقاً ملف ترحيل جديد في `backend/database/migrations/` فطبّقه مرة واحدة بعد رفع النسخة، باسم مستخدم التطبيق حتى تبقى الجداول ملكه:

```bash
sudo -u postgres psql -d qadiyati -v ON_ERROR_STOP=1 -c 'SET ROLE qadiyati' \
  -f /opt/qadiyati/backend/database/migrations/0008_اسم_الملف.sql
sudo systemctl restart qadiyati-api
```

## 9. النسخ الاحتياطي

- تلقائياً كل ليلة الساعة 3:00 في `/var/backups/qadiyati` (قاعدة البيانات + المستندات، آخر 14 يوماً).
- نسخة يدوية الآن: `sudo qadiyati-backup`
- **انسخها خارج اللابتوب** دورياً (عطل القرص يضيّع الخادم والنسخ معاً). من جهازك:
  ```powershell
  scp -r ubuntu@192.168.1.50:/var/backups/qadiyati D:\qadiyati-backups
  ```
  (أعطِ مستخدمك صلاحية القراءة أولاً: `sudo chmod 755 /var/backups/qadiyati && sudo chmod 644 /var/backups/qadiyati/*`)

- **التحقق:** كل نسخة تُفحص فور أخذها: يجب أن تُقرأ قائمة محتويات قاعدة البيانات (`pg_restore --list`) وأن يُفتح أرشيف المستندات. نتيجة كل ليلة (الحجم، وبصمة SHA-256، ونجاح الفحص) تُكتب في `/var/lib/qadiyati/backup-status.json`، وتظهر لمدير المنصّة في صفحة **النسخ الاحتياطية**. إن مرّ أكثر من 36 ساعة دون نسخة سليمة تظهر الصفحة تحذيراً.
- **نسخة المكتب الواحد:** صاحب كل مكتب يستطيع من صفحة **الأمان والصلاحيات** تنزيل ملف JSON ببيانات مكتبه وحده، معه بصمة SHA-256 يتحقق منها في الصفحة نفسها. (الملفات المرفوعة نفسها لا تدخل فيه، بل سجلاتها فقط.)

**الاسترجاع** (يستبدل البيانات الحالية، مع طريق للرجوع):
```bash
ls /var/backups/qadiyati                    # اختر التاريخ، مثل 2026-11-28_0300
sudo qadiyati-restore 2026-11-28_0300       # قاعدة البيانات والمستندات
sudo qadiyati-restore 2026-11-28_0300 --db-only   # قاعدة البيانات وحدها
```
ما يفعله السكربت بالترتيب، ويتوقف عند أول خطأ:
1. يطابق بصمة النسخة مع المسجّلة ليلة أخذها، ويتأكد أنها سليمة.
2. يأخذ **لقطة من الوضع الحالي** (`pre-restore_الوقت.dump` و`.tar.gz`).
3. يوقف الخادم ويسترجع قاعدة البيانات **في معاملة واحدة** (إن فشلت لا يتغيّر شيء)، ثم المستندات مع الإبقاء على القديمة جانباً.
4. يشغّل الخادم ويفحص `/api/health`؛ إن لم يستجب يعيد اللقطة تلقائياً.

**للتراجع عن استرجاع تمّ:** `sudo qadiyati-restore pre-restore_الوقت` (اللقطات تبقى 30 يوماً، ويطبع السكربت الأمر الدقيق في آخره).

## 10. (اختياري) نقل بياناتك المحلية

التشغيل الحقيقي يُفضَّل أن يبدأ بقاعدة بيانات نظيفة. قاعدتك المحلية فيها **حسابات تجريبية بكلمة مرور `demo1234`**؛ إن نقلتها فاحذف هذه الحسابات أو غيّر كلماتها قبل فتح الموقع للناس.

للنقل بعد إكمال التثبيت (الخطوة 2). **هذا يستبدل كل ما في قاعدة بيانات الخادم:**

1. على ويندوز:
   ```powershell
   & "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" -U postgres -d smart_law_firm_dev --no-owner --no-privileges -f "$env:TEMP\qadiyati.sql"
   scp "$env:TEMP\qadiyati.sql" ubuntu@192.168.1.50:/tmp/
   scp -r ".\backend\private-documents" ubuntu@192.168.1.50:/tmp/
   ```
2. على الخادم:
   ```bash
   sudo systemctl stop qadiyati-api
   sudo -u postgres psql -v ON_ERROR_STOP=1 -c 'DROP DATABASE qadiyati' \
     -c "CREATE DATABASE qadiyati OWNER qadiyati ENCODING 'UTF8' TEMPLATE template0"
   sudo -u postgres psql -d qadiyati -v ON_ERROR_STOP=1 -c 'SET ROLE qadiyati' -f /tmp/qadiyati.sql
   sudo cp -a /tmp/private-documents/. /opt/qadiyati/backend/private-documents/
   sudo chown -R qadiyati:qadiyati /opt/qadiyati/backend/private-documents
   sudo systemctl start qadiyati-api
   rm -rf /tmp/qadiyati.sql /tmp/private-documents
   ```

## حل المشكلات

| المشكلة | الأمر |
|---|---|
| الموقع لا يفتح | `sudo systemctl status cloudflared qadiyati-api nginx --no-pager` |
| سجلّ الخادم الخلفي | `sudo journalctl -u qadiyati-api -n 100 --no-pager` |
| `Origin protection cannot be disabled in production` | احذف السطر `ENFORCE_ORIGIN_PROTECTION=false` من `.env` الخادم |
| `BETTER_AUTH_URL must use HTTPS` | تأكد أن `BETTER_AUTH_URL=https://qadiyati.ps` |
| البريد لا يصل | تأكد أن الدومين **Verified** في Resend وأن `RESEND_API_KEY` صحيح، ثم `sudo systemctl restart qadiyati-api` |
| «طلبات كثيرة» عند الدخول لكل المستخدمين | تأكد من وجود `TRUST_PROXY=loopback` في `.env` |
| خطأ 502 من Cloudflare | الخدمة متوقفة: `sudo systemctl restart qadiyati-api nginx` |
| فحص الخادم الخلفي مباشرة | `curl http://127.0.0.1:3000/api/health` |
| الخدمة تفشل بـ `status=226/NAMESPACE` (في حاوية LXC) | فعّل **Nesting** للحاوية من Proxmox وأعد تشغيلها؛ أو علّق أسطر `Protect*` في `/etc/systemd/system/qadiyati-api.service` ثم `sudo systemctl daemon-reload` |

## الأمان باختصار

- ملف `/opt/qadiyati/backend/.env` لا يقرؤه إلا مستخدم الخدمة (`chmod 600`). لا ترسله ولا ترفعه إلى GitHub.
- الجدار الناري لا يفتح إلا SSH؛ nginx والخادم الخلفي يستمعان على `127.0.0.1` فقط.
- قاعدة البيانات تعمل بمستخدم بلا صلاحيات superuser.
- الخدمة تعمل بمستخدم نظام مستقل لا يكتب إلا في مجلدَي المستندات.
- يُنصح بالدخول إلى الخادم بمفتاح SSH بدل كلمة المرور: `ssh-keygen` ثم `ssh-copy-id ubuntu@192.168.1.50`.
