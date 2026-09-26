import json
import time
from collections import deque
import paho.mqtt.client as mqtt

# MQTT Setup
MQTT_SERVER = "broker.hivemq.com"
MQTT_PORT = 1883
TOPIC_TELEMETRY = "takim12/telemetry"
TOPIC_COMMAND = "btu/rukiye/proje/komut"
TOPIC_AI_ANALYSIS = "takim12/ai_analysis"

# ESP32 Thresholds
CO_DANGER = 1200
CO_WARNING = 900
AIR_DANGER = 2000
AIR_WARNING = 2000
PM_DANGER = 2000
PM_WARNING = 2000

# Sliding window history size (approx. 1 minute of data if interval is 2s)
HISTORY_SIZE = 30
co_history = deque(maxlen=HISTORY_SIZE)
air_history = deque(maxlen=HISTORY_SIZE)
pm_history = deque(maxlen=HISTORY_SIZE)
time_history = deque(maxlen=HISTORY_SIZE)

# Control states
early_fan_active = False

def calculate_slope(x_list, y_list):
    """Calculates the slope (rate of change per second) using simple linear regression."""
    n = len(x_list)
    if n < 5:  # Not enough data points
        return 0.0
    
    # Map timestamps to seconds relative to the first timestamp in window
    t0 = x_list[0]
    x_rel = [t - t0 for t in x_list]
    
    sum_x = sum(x_rel)
    sum_y = sum(y_list)
    sum_xx = sum(x * x for x in x_rel)
    sum_xy = sum(x * y for x, y in zip(x_rel, y_list))
    
    denominator = (n * sum_xx - sum_x * sum_x)
    if denominator == 0:
        return 0.0
    
    slope = (n * sum_xy - sum_x * sum_y) / denominator
    return slope

def map_risk_score(co, air, pm, co_slope, air_slope, pm_slope):
    """
    Computes a risk score from 0 to 100.
    0-30: Safe (Green)
    30-60: Attention (Yellow)
    60-80: Risky (Orange)
    80-100: Emergency (Red)
    """
    # Base scoring based on sensor values relative to Danger threshold (max 80 base)
    score_co = min(80.0, (co / CO_DANGER) * 80.0) if co <= CO_DANGER else 80.0 + min(20.0, ((co - CO_DANGER) / (4095 - CO_DANGER)) * 20.0)
    score_air = min(80.0, (air / AIR_DANGER) * 80.0) if air <= AIR_DANGER else 80.0 + min(20.0, ((air - AIR_DANGER) / (4095 - AIR_DANGER)) * 20.0)
    score_pm = min(80.0, (pm / PM_DANGER) * 80.0) if pm <= PM_DANGER else 80.0 + min(20.0, ((pm - PM_DANGER) / (4095 - PM_DANGER)) * 20.0)
    
    base_score = max(score_co, score_air, score_pm)
    
    # Add trend bonus (if values are rising rapidly, increase the risk score to alert the user)
    bonus = 0.0
    # If CO slope is positive and fast
    if co_slope > 1.0: # Rising by >1 unit per second
        bonus += min(10.0, co_slope * 2.0)
    if air_slope > 2.0:
        bonus += min(5.0, air_slope * 0.5)
    if pm_slope > 2.0:
        bonus += min(5.0, pm_slope * 0.5)
        
    final_score = min(100.0, base_score + bonus)
    return round(final_score)

def generate_ai_commentary(co, air, pm, co_slope, air_slope, pm_slope, faults, early_fan):
    """Generates dynamic AI feedback text based on trend analysis and thresholds."""
    if faults:
        return f"DİKKAT: Donanım arızası tespit edildi. {', '.join(faults)}. Lütfen sensör bağlantılarını kontrol edin."
        
    comments = []
    
    # Trend descriptions
    if co_slope > 2.0:
        comments.append("Karbonmonoksit (CO) seviyesinde kritik ve hızlı bir artış trendi var!")
    elif co_slope > 0.5:
        comments.append("CO seviyesi yükselme eğiliminde.")
        
    if air_slope > 3.0:
        comments.append("MQ-135 hava kalitesi değeri hızla kötüleşiyor.")
    
    if pm_slope > 3.0:
        comments.append("PM2.5 toz miktarı artıyor.")
        
    # Threshold crossings
    if co >= CO_DANGER or air >= AIR_DANGER or pm >= PM_DANGER:
        comments.append("Ortamda tehlikeli düzeyde gaz veya toz birikimi saptandı! Havalandırma tam kapasite çalışıyor.")
        return " ".join(comments)

    # Predictive warnings
    if early_fan:
        comments.append("Tahmini olarak 1 dakika içinde limitler aşılacak. Havalandırma erken çalıştırıldı.")
        return " ".join(comments)
        
    if not comments:
        comments.append("Tüm sensör değerleri kararlı ve güvenli sınırlar içerisinde. Ortam temiz.")
        
    return " ".join(comments)

def on_connect(client, userdata, flags, rc):
    print(f"MQTT Sunucusuna baglandi. Durum Kodu: {rc}")
    client.subscribe(TOPIC_TELEMETRY)
    print(f"Abone olunan kanal: {TOPIC_TELEMETRY}")

def on_message(client, userdata, msg):
    global early_fan_active
    
    try:
        payload = json.loads(msg.payload.decode())
        
        # Extract telemetry fields
        co = payload.get("co_raw", 0)
        air = payload.get("air_raw", 0)
        pm = payload.get("pm25_raw", 0)
        fan_status = payload.get("fan", False)
        override_status = payload.get("override", "auto")
        
        timestamp = time.time()
        
        # Append to sliding window histories
        co_history.append(co)
        air_history.append(air)
        pm_history.append(pm)
        time_history.append(timestamp)
        
        # Calculate slopes (units per second)
        co_slope = calculate_slope(time_history, co_history)
        air_slope = calculate_slope(time_history, air_history)
        pm_slope = calculate_slope(time_history, pm_history)
        
        # Anomaly / Fault Detection
        faults = []
        if co >= 4090 or co <= 5:
            faults.append("MQ-7 (CO) Bağlantısı Koptu / Hatalı Okuma")
        if air >= 4090 or air <= 5:
            faults.append("MQ-135 (Hava) Bağlantısı Koptu / Hatalı Okuma")
        if pm >= 4090 or pm <= 5:
            # Note: PM sensor can read near 0 under perfect conditions, but let's check max
            pass
            
        # Check sudden impossible jumps (e.g. delta > 1500 in 2 seconds)
        if len(co_history) >= 2:
            if abs(co_history[-1] - co_history[-2]) > 1500:
                faults.append("MQ-7 Sinyalinde Ani Sıçrama (Gürültü/Hata)")
            if abs(air_history[-1] - air_history[-2]) > 1500:
                faults.append("MQ-135 Sinyalinde Ani Sıçrama (Gürültü/Hata)")
        
        # Early fan activation rule based on trends
        # If values are rising and will exceed danger threshold in less than 60 seconds:
        early_trigger = False
        if not faults and override_status == "auto":
            # Time to limit = (Danger Limit - Current) / slope
            # Only trigger if current is already above warning, or trend is extremely fast.
            # CO:
            if co_slope > 1.5 and co >= CO_WARNING:
                time_to_co_danger = (CO_DANGER - co) / co_slope
                if 0 < time_to_co_danger < 60:
                    early_trigger = True
                    
            # PM or Air:
            if air_slope > 2.0 and air >= (AIR_DANGER - 400):
                time_to_air_danger = (AIR_DANGER - air) / air_slope
                if 0 < time_to_air_danger < 60:
                    early_trigger = True

        # Send commands to ESP32 for early fan trigger
        if early_trigger and not early_fan_active:
            print("Yapay Zeka: Hızlı artış trendi saptandı! Erken havalandırma komutu gönderiliyor...")
            client.publish(TOPIC_COMMAND, "FAN_ON")
            early_fan_active = True
        elif not early_trigger and early_fan_active:
            # Only release early fan if current levels are safe
            if co < CO_WARNING and air < AIR_WARNING and pm < PM_WARNING:
                print("Yapay Zeka: Sensör değerleri normale döndü. Erken havalandırma kapatılıyor...")
                client.publish(TOPIC_COMMAND, "FAN_AUTO")
                early_fan_active = False

        # Calculate final Risk Score (0-100)
        risk_score = map_risk_score(co, air, pm, co_slope, air_slope, pm_slope)
        
        # Risk label
        if risk_score < 30:
            risk_label = "GUVENLI"
        elif risk_score < 60:
            risk_label = "DIKKAT"
        elif risk_score < 80:
            risk_label = "RISKLI"
        else:
            risk_label = "TEHLIKE"
            
        # Generate Commentary
        commentary = generate_ai_commentary(
            co, air, pm, 
            co_slope, air_slope, pm_slope, 
            faults, early_fan_active
        )
        
        # Compile AI analysis payload
        ai_payload = {
            "risk_score": risk_score,
            "risk_label": risk_label,
            "co_trend": "Artıyor" if co_slope > 0.5 else ("Azalıyor" if co_slope < -0.5 else "Stabil"),
            "air_trend": "Artıyor" if air_slope > 0.5 else ("Azalıyor" if air_slope < -0.5 else "Stabil"),
            "pm_trend": "Artıyor" if pm_slope > 0.5 else ("Azalıyor" if pm_slope < -0.5 else "Stabil"),
            "co_slope": round(co_slope, 2),
            "air_slope": round(air_slope, 2),
            "pm_slope": round(pm_slope, 2),
            "commentary": commentary,
            "faults": faults,
            "early_fan": early_fan_active
        }
        
        # Publish analysis back
        client.publish(TOPIC_AI_ANALYSIS, json.dumps(ai_payload))
        
        # Log to terminal
        print(f"[{time.strftime('%H:%M:%S')}] CO: {co} ({ai_payload['co_trend']}) | Hava: {air} | Toz: {pm} | Risk Skoru: {risk_score}% ({risk_label})")
        if faults:
            print(f"  HATA UYARILARI: {faults}")
        if early_fan_active:
            print("  Yapay Zeka Erken Havalandırma: AÇIK")
            
    except Exception as e:
        print(f"Hata olustu: {e}")

def main():
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    
    print("Yapay Zeka Analizörü baslatiliyor...")
    try:
        client.connect(MQTT_SERVER, MQTT_PORT, 60)
    except Exception as e:
        print(f"Sunucu baglantisi basarisiz: {e}")
        return
        
    client.loop_forever()

if __name__ == "__main__":
    main()
