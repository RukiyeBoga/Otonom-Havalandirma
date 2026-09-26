# Otonom Havalandırma ve Maden Güvenliği Sistemi

Bu proje, maden ortamındaki karbonmonoksit, hava kalitesi ve toz yoğunluğunu gerçek zamanlı olarak izleyen ESP32 tabanlı bir IoT sistemidir.

Sensörlerden alınan değerlere göre ortam **Güvenli**, **Uyarı** veya **Tehlike** olarak sınıflandırılır. Sistem, risk durumuna göre LED göstergesini ve 12V havalandırma fanını otomatik olarak kontrol eder. Ölçümler MQTT üzerinden web kontrol paneline gönderilir.

## Sistem Durumları

| Durum | LED | Fan |
|---|---|---|
| Güvenli | Yeşil | Kapalı |
| Uyarı | Sarı | Açık |
| Tehlike | Yanıp sönen kırmızı | Açık |

## Kullanılan Donanımlar

- ESP32
- MQ-7 karbonmonoksit sensörü
- MQ-135 hava kalitesi sensörü
- PM2.5 toz sensörü
- SSD1306 OLED ekran
- WS2812 NeoPixel LED
- 5V röle modülü
- 12V DC fan
- Harici 12V güç kaynağı

## ESP32 Pin Bağlantıları

| Bileşen | ESP32 pini |
|---|---|
| MQ-7 analog çıkışı | GPIO34 |
| MQ-135 analog çıkışı | GPIO35 |
| PM2.5 analog çıkışı | GPIO32 |
| PM sensörü LED kontrolü | GPIO4 |
| Röle IN | GPIO26 |
| NeoPixel veri pini | GPIO13 |
| OLED SDA | GPIO21 |
| OLED SCL | GPIO22 |

## Risk Eşikleri

Kullanılan değerler ham ESP32 ADC ölçümleridir.

| Sensör | Uyarı | Tehlike |
|---|---:|---:|
| MQ-7 | 350 | 400 |
| MQ-135 | 1300 | 1500 |
| PM2.5 | 1200 | 1400 |

Gerçek kullanım öncesinde sensörlerin kalibre edilmesi ve değerlerin ppm veya µg/m³ birimlerine dönüştürülmesi gerekmektedir.

## MQTT Haberleşmesi

- MQTT broker: `broker.hivemq.com`
- MQTT portu: `1883`
- Telemetri topic: `takim12/telemetry`
- Durum topic: `btu/rukiye/proje/durum`
- Komut topic: `btu/rukiye/proje/komut`

## Web Paneli

Web panelinde aşağıdaki bilgiler görüntülenmektedir:

- Anlık sensör değerleri
- Genel risk skoru
- Güvenli, uyarı ve tehlike durumları
- Fan çalışma durumu
- Sensör zaman serisi grafikleri
- Sistem olay geçmişi
- Yapay zekâ analiz yorumları
- Manuel ve otomatik fan kontrolü

## Web Panelini Çalıştırma

Terminalde proje içerisindeki `ai_dashboard` klasörüne girilir:

```bash
cd ai_dashboard
python -m http.server 8080
```

Daha sonra tarayıcıdan aşağıdaki adres açılır:

```text
http://127.0.0.1:8080
```

## AI Analizörünü Çalıştırma

Öncelikle gerekli Python kütüphanesi kurulur:

```bash
pip install paho-mqtt
```

Ardından analizör çalıştırılır:

```bash
cd ai_dashboard
python ai_analyzer.py
```

## Donanım Olmadan Test Etme

ESP32 bağlı değilken örnek sensör verileri üretmek için:

```bash
cd ai_dashboard
python mock_telemetry.py
```

## Gerekli Arduino Kütüphaneleri

- WiFi
- PubSubClient
- Wire
- Adafruit GFX Library
- Adafruit SSD1306
- Adafruit NeoPixel

Ana Arduino programı `sketch_jun2a.ino` dosyasında bulunmaktadır.

## Proje Yapısı

```text
Otonom-Havalandirma/
├── sketch_jun2a.ino
└── ai_dashboard/
    ├── index.html
    ├── style.css
    ├── app.js
    ├── ai_analyzer.py
    └── mock_telemetry.py
```

## Güvenlik Notu

Wi-Fi adı ve parolası herkese açık kaynak kodunda paylaşılmamalıdır. Proje GitHub'a yüklenmeden önce bu bilgiler örnek değerlerle değiştirilmelidir.

## Proje Bilgileri

- Ders: Nesnelerin İnterneti
- Proje: Maden Güvenliği için Akıllı Hava Kalite Sistemi
- Takım: 12
- Üniversite: Bursa Teknik Üniversitesi
