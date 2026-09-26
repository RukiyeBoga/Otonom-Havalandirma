import json
import time
import random
import paho.mqtt.client as mqtt

MQTT_SERVER = "broker.hivemq.com"
MQTT_PORT = 1883
TOPIC_TELEMETRY = "takim12/telemetry"
TOPIC_COMMAND = "btu/rukiye/proje/komut"

# Active states
fan_state = False
override_state = "auto"

def on_connect(client, userdata, flags, rc):
    print(f"Mock ESP32 MQTT Baglandi. Durum: {rc}")
    client.subscribe(TOPIC_COMMAND)
    print(f"Abone olunan komut kanali: {TOPIC_COMMAND}")

def on_message(client, userdata, msg):
    global fan_state, override_state
    message = msg.payload.decode()
    print(f"[MOCK ESP32 RECEIVED COMMAND]: {message}")
    if message == "FAN_ON":
        fan_state = True
        override_state = "manual"
    elif message == "FAN_OFF":
        fan_state = False
        override_state = "manual"
    elif message == "FAN_AUTO":
        override_state = "auto"

def run_simulation():
    global fan_state, override_state
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    
    print("Mock ESP32 Telemetri Simulatoru baslatiliyor...")
    client.connect(MQTT_SERVER, MQTT_PORT, 60)
    client.loop_start()

    uptime = 0
    
    # Scenarios list
    print("\n--- SIMULASYON MODLARI ---")
    print("1: Kararli / Temiz Hava (CO: ~400, MQ135: ~600, PM2.5: ~300)")
    print("2: Karbonmonoksit (CO) Sizintisi / Yukselis Trendi (CO: 400 -> 1400)")
    print("3: Kritik Tehlike Seviyesi (Tum degerler cok yuksek)")
    print("4: MQ-7 Sensör Arizasi (CO bir anda 4095 okuyor)")
    print("--------------------------")
    
    current_mode = "1"
    
    co = 420
    air = 650
    pm = 350
    
    try:
        while True:
            # Check user input or run automated cycle
            # For simplicity, we can do a prompt or let the user choose.
            # We'll read console input in a non-blocking way, or we can just print choices every 10 iterations.
            # To make it easy, let's print a small menu and ask the user to type if they want, but default to running.
            
            # Let's change values based on the current mode
            if current_mode == "1":
                # Stable Safe Air
                co = max(100, min(800, co + random.randint(-15, 15)))
                air = max(300, min(1000, air + random.randint(-20, 20)))
                pm = max(100, min(800, pm + random.randint(-15, 15)))
                if override_state == "auto":
                    # Automatic ESP32 rules (Safe)
                    fan_state = False
            elif current_mode == "2":
                # CO Leak (Rising trend)
                co += random.randint(35, 75)  # Quick rise
                air = max(300, min(1200, air + random.randint(-10, 30)))
                pm = max(100, min(1000, pm + random.randint(-10, 25)))
                
                # Check ESP32 auto thresholds (in case no override)
                if override_state == "auto":
                    if co >= 1200:
                        fan_state = True
            elif current_mode == "3":
                # Critical Danger
                co = max(1300, min(2500, co + random.randint(-30, 30)))
                air = max(2100, min(3000, air + random.randint(-30, 30)))
                pm = max(2100, min(3000, pm + random.randint(-30, 30)))
                if override_state == "auto":
                    fan_state = True
            elif current_mode == "4":
                # MQ-7 Sensor Failure (Disconnected wire or sudden spike to max 4095)
                co = 4095
                air = max(300, min(1000, air + random.randint(-10, 10)))
                pm = max(100, min(800, pm + random.randint(-10, 10)))
                # The ESP32's risk check for 4095: CO danger is >= 1200, so it will turn on fan
                if override_state == "auto":
                    fan_state = True

            # Risk calculation logic mimicking ESP32:
            # Danger is >= 1200 for CO, >= 2000 for Air, >= 2000 for PM
            is_danger = co >= 1200 or air >= 2000 or pm >= 2000 or (co >= 900 and pm >= 2000)
            is_warning = co >= 900 or air >= 2000 or pm >= 2000
            
            risk_text = "GUVENLI"
            if is_danger:
                risk_text = "TEHLIKE"
            elif is_warning:
                risk_text = "UYARI"
                
            # Formulate ESP32 Payload
            payload = {
                "team": 12,
                "co_raw": co,
                "air_raw": air,
                "pm25_raw": pm,
                "risk": risk_text,
                "fan": fan_state,
                "override": override_state,
                "uptime_ms": uptime * 2000
            }
            
            client.publish(TOPIC_TELEMETRY, json.dumps(payload))
            print(f"Published Telemetry: CO={co}, Hava={air}, Toz={pm}, Fan={fan_state}, Mod={override_state} | Risk={risk_text}")
            
            # Sleep 2 seconds (sensor interval)
            time.sleep(2)
            uptime += 1
            
            # Check if user wanted to change simulation mode via console
            # To prevent blocking, we just let them press Ctrl+C or we can check a simple input counter.
            # Let's guide the user to change mode by typing:
            if uptime % 10 == 0:
                print("\n>>> MOD DEGISTIRMEK ICIN:")
                print("1: Temiz Hava | 2: CO Sizintisi (Erken Fan Testi) | 3: Kritik Durum | 4: MQ7 Arizasi")
                # Non-blocking input is tricky in standard python across systems, 
                # but we can let them input if they run manually.
                # We can just write a file or wait for key. Let's make it automatically cycle or read input.
                # Since this is a test script, we can print that they can edit the script or use interactive input.
                print("Degistirmek istediginiz modun numarasini yazip Enter'a basin (Gecmek icin sadece Enter):")
                import select
                import sys
                if sys.platform != "win32":
                    i, o, e = select.select([sys.stdin], [], [], 3.0)
                    if i:
                        val = sys.stdin.readline().strip()
                        if val in ["1", "2", "3", "4"]:
                            current_mode = val
                            print(f"-> Mod {current_mode} olarak degistirildi!\n")
                else:
                    # On Windows, we can use a quick input with timeout or just let it prompt.
                    # Since it is Windows, we can do a prompt, but to avoid blocking forever,
                    # we can just write a simple prompt with a try-except, or run an automated sequence:
                    # Let's run a automated sequence: 
                    # 15 seconds clean air -> 40 seconds leak -> 20 seconds danger -> 10 seconds fault -> clean air
                    if uptime < 15:
                        current_mode = "1"
                    elif uptime < 40:
                        current_mode = "2"
                    elif uptime < 55:
                        current_mode = "3"
                    elif uptime < 70:
                        current_mode = "4"
                    else:
                        # Reset
                        uptime = 0
                        current_mode = "1"
                        co = 420
                        air = 650
                        pm = 350
                    print(f"-> Otomatik Simulasyon Dizisi: Aktif Mod = {current_mode} (Adim {uptime})")

    except KeyboardInterrupt:
        print("Simulator durduruldu.")
        client.loop_stop()
        client.disconnect()

if __name__ == "__main__":
    run_simulation()
