// Main Dashboard JS Logic

// MQTT Configuration
const MQTT_BROKER = "broker.hivemq.com";
const MQTT_PORT = 8884; // Secure WSS port
const MQTT_PATH = "/mqtt";
const CLIENT_ID = "btu_maden_web_" + Math.random().toString(36).substring(2, 10);

const TOPIC_TELEMETRY = "takim12/telemetry";
const TOPIC_AI_ANALYSIS = "takim12/ai_analysis";
const TOPIC_COMMAND = "btu/rukiye/proje/komut";

// State Variables
let mqttClient = null;
let lastTelemetryTime = 0;
let watchdogInterval = null;

// History for Chart (max 50 points)
const MAX_HISTORY_POINTS = 50;
const historyData = {
    timestamps: [],
    co: [],
    air: [],
    pm: []
};
let activeTab = "co"; // 'co', 'air', or 'pm'
let timeSeriesChart = null;

// Prev State tracking for Logs
let prevState = {
    fan: null,
    risk: null,
    override: null,
    faultsCount: 0
};

// UI Elements
const elMqttDot = document.getElementById("mqtt-status-dot");
const elMqttText = document.getElementById("mqtt-status-text");
const elEspDot = document.getElementById("esp32-status-icon");
const elEspText = document.getElementById("esp32-status-text");
const elClock = document.getElementById("live-time");
const elDate = document.getElementById("live-date");

const elCoVal = document.getElementById("co-value");
const elAirVal = document.getElementById("air-value");
const elPmVal = document.getElementById("pm-value");

const elCoProgress = document.getElementById("co-progress");
const elAirProgress = document.getElementById("air-progress");
const elPmProgress = document.getElementById("pm-progress");

const elCoTrendText = document.getElementById("co-trend-text");
const elAirTrendText = document.getElementById("air-trend-text");
const elPmTrendText = document.getElementById("pm-trend-text");
const elCoTrendIcon = document.getElementById("co-trend-icon");
const elAirTrendIcon = document.getElementById("air-trend-icon");
const elPmTrendIcon = document.getElementById("pm-trend-icon");
const elCoTrendCont = document.getElementById("co-trend-container");
const elAirTrendCont = document.getElementById("air-trend-container");
const elPmTrendCont = document.getElementById("pm-trend-container");

const elRiskGauge = document.getElementById("risk-gauge");
const elRiskNum = document.getElementById("risk-number");
const elRiskBadge = document.getElementById("risk-badge");

const elFanIconBg = document.getElementById("fan-icon-bg");
const elFanIcon = document.getElementById("fan-icon");
const elFanStatusText = document.getElementById("fan-status-text");
const elFanModeBadge = document.getElementById("fan-mode-badge");

const elAiComment = document.getElementById("ai-commentary-text");
const elFaultBanner = document.getElementById("fault-banner");
const elFaultBannerText = document.getElementById("fault-banner-text");

const btnFanOn = document.getElementById("btn-fan-on");
const btnFanOff = document.getElementById("btn-fan-off");
const btnFanAuto = document.getElementById("btn-fan-auto");
const btnClearLogs = document.getElementById("btn-clear-logs");
const elLogsTbody = document.getElementById("logs-tbody");

// 1. Live Clock & Date Update
function updateClock() {
    const now = new Date();
    elClock.textContent = now.toLocaleTimeString('tr-TR');
    elDate.textContent = now.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
setInterval(updateClock, 1000);
updateClock();

// 2. Event Logger Function
function addLogEntry(category, message, level = "info") {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('tr-TR');
    
    // Remove default empty message
    if (elLogsTbody.rows.length === 1 && elLogsTbody.rows[0].cells.length === 1) {
        elLogsTbody.innerHTML = "";
    }
    
    let colorClass = "text-gray-400";
    let iconClass = "fa-circle-info";
    
    if (level === "warning") {
        colorClass = "text-amber-400 font-bold";
        iconClass = "fa-triangle-exclamation";
    } else if (level === "danger") {
        colorClass = "text-red-400 font-bold";
        iconClass = "fa-radiation animate-pulse";
    } else if (level === "success") {
        colorClass = "text-emerald-400";
        iconClass = "fa-circle-check";
    } else if (level === "ai") {
        colorClass = "text-cyan-400 font-medium";
        iconClass = "fa-brain-circuit";
    } else if (level === "fault") {
        colorClass = "text-purple-400 font-bold";
        iconClass = "fa-circle-xmark";
    }

    const row = document.createElement("tr");
    row.className = "hover:bg-white/5 transition-colors duration-150";
    row.innerHTML = `
        <td class="p-3 text-gray-500">${timeStr}</td>
        <td class="p-3 uppercase tracking-wider ${colorClass} font-semibold flex items-center gap-1.5">
            <i class="fa-solid ${iconClass}"></i> ${category}
        </td>
        <td class="p-3 text-gray-300 font-sans">${message}</td>
    `;
    
    // Insert at the top of the logs
    elLogsTbody.insertBefore(row, elLogsTbody.firstChild);
    
    // Keep max 40 logs
    if (elLogsTbody.rows.length > 40) {
        elLogsTbody.removeChild(elLogsTbody.lastChild);
    }
}

btnClearLogs.addEventListener("click", () => {
    elLogsTbody.innerHTML = `
        <tr>
            <td colspan="3" class="p-4 text-center text-gray-500">Sistem olay günlüğü temizlendi.</td>
        </tr>
    `;
});

// 3. Chart.js Setup
function initChart() {
    const ctx = document.getElementById('timeSeriesChart').getContext('2d');
    
    // Custom Chart styles
    Chart.defaults.color = 'rgba(156, 163, 175, 0.6)';
    Chart.defaults.font.family = 'Inter';
    
    timeSeriesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Sensör Değeri',
                data: [],
                borderColor: '#06b6d4',
                backgroundColor: 'rgba(6, 182, 212, 0.1)',
                borderWidth: 2,
                pointRadius: 2,
                pointHoverRadius: 5,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(22, 25, 43, 0.95)',
                    titleColor: '#fff',
                    bodyColor: '#06b6d4',
                    borderColor: 'rgba(255,255,255,0.08)',
                    borderWidth: 1,
                    cornerRadius: 8,
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.03)'
                    },
                    ticks: {
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 6
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.03)'
                    },
                    suggestedMin: 0,
                    suggestedMax: 2500
                }
            }
        }
    });
}

function updateChart() {
    if (!timeSeriesChart) return;
    
    let chartData = [];
    let label = "";
    let color = "";
    let maxVal = 2500;
    
    if (activeTab === "co") {
        chartData = historyData.co;
        label = "MQ-7 (CO)";
        color = "#f43f5e"; // Rose
        maxVal = 1600;
    } else if (activeTab === "air") {
        chartData = historyData.air;
        label = "MQ-135 (Hava)";
        color = "#eab308"; // Amber
        maxVal = 2500;
    } else if (activeTab === "pm") {
        chartData = historyData.pm;
        label = "PM2.5 Toz";
        color = "#06b6d4"; // Cyan
        maxVal = 2500;
    }
    
    timeSeriesChart.data.labels = historyData.timestamps;
    timeSeriesChart.data.datasets[0].data = chartData;
    timeSeriesChart.data.datasets[0].label = label;
    timeSeriesChart.data.datasets[0].borderColor = color;
    timeSeriesChart.data.datasets[0].backgroundColor = color + "1a"; // 10% opacity hex
    
    timeSeriesChart.options.scales.y.suggestedMax = maxVal;
    timeSeriesChart.update();
}

// Chart Tab Event Listeners
const tabs = {
    co: document.getElementById("chart-tab-co"),
    air: document.getElementById("chart-tab-air"),
    pm: document.getElementById("chart-tab-pm")
};

function selectTab(tabName) {
    activeTab = tabName;
    
    // Update active tab buttons styles
    Object.keys(tabs).forEach(k => {
        if (k === tabName) {
            tabs[k].className = "px-3 py-1 text-xs font-bold rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 transition-all duration-200";
        } else {
            tabs[k].className = "px-3 py-1 text-xs font-bold rounded-lg bg-white/5 text-gray-400 border border-white/5 transition-all duration-200";
        }
    });
    
    updateChart();
}

tabs.co.addEventListener("click", () => selectTab("co"));
tabs.air.addEventListener("click", () => selectTab("air"));
tabs.pm.addEventListener("click", () => selectTab("pm"));


// 4. MQTT Connection
function connectMqtt() {
    elMqttDot.className = "w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse";
    elMqttText.textContent = "Sunucu: Bağlanıyor";

    mqttClient = new Paho.MQTT.Client(MQTT_BROKER, Number(MQTT_PORT), MQTT_PATH, CLIENT_ID);
    
    mqttClient.onConnectionLost = (responseObject) => {
        elMqttDot.className = "w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse";
        elMqttText.textContent = "Sunucu: Bağlantı Koptu";
        console.log("MQTT Connection Lost: " + responseObject.errorMessage);
        addLogEntry("MQTT", "Sunucu bağlantısı koptu. Yeniden bağlanıyor...", "warning");
        setTimeout(connectMqtt, 5000);
    };
    
    mqttClient.onMessageArrived = (message) => {
        const topic = message.destinationName;
        const payload = message.payloadString;
        
        if (topic === TOPIC_TELEMETRY) {
            handleTelemetry(payload);
        } else if (topic === TOPIC_AI_ANALYSIS) {
            handleAiAnalysis(payload);
        }
    };
    
    const connectOptions = {
        useSSL: true,
        onSuccess: () => {
            elMqttDot.className = "w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse";
            elMqttText.textContent = "Sunucu: Aktif";
            addLogEntry("MQTT", "Broker sunucusuna başarıyla bağlanıldı.", "success");
            
            // Subscribe to telemetry and AI channels
            mqttClient.subscribe(TOPIC_TELEMETRY);
            mqttClient.subscribe(TOPIC_AI_ANALYSIS);
        },
        onFailure: (err) => {
            elMqttDot.className = "w-2.5 h-2.5 rounded-full bg-red-500";
            elMqttText.textContent = "Sunucu: Hata";
            console.log("MQTT Connection Failed: ", err);
            setTimeout(connectMqtt, 5000);
        }
    };
    
    mqttClient.connect(connectOptions);
}

// 5. Watchdog watchdog timer for ESP32 connection
function startWatchdog() {
    if (watchdogInterval) clearInterval(watchdogInterval);
    
    watchdogInterval = setInterval(() => {
        const now = Date.now();
        // If no messages for 6 seconds, assume disconnected
        if (lastTelemetryTime > 0 && now - lastTelemetryTime > 6000) {
            elEspDot.className = "fa-solid fa-microchip text-xs text-red-500 animate-pulse";
            elEspText.textContent = "ESP32: Bağlantı Koptu";
            elEspText.className = "text-xs font-mono text-red-500";
            
            if (prevState.espConnected !== false) {
                addLogEntry("CIHAZ", "ESP32 donanım ünitesi ile sinyal kesildi!", "warning");
                prevState.espConnected = false;
            }
        }
    }, 2000);
}

// 6. Handle Incoming Telemetry JSON
function handleTelemetry(payloadStr) {
    lastTelemetryTime = Date.now();
    
    // ESP32 Status Active UI
    elEspDot.className = "fa-solid fa-microchip text-xs text-emerald-400";
    elEspText.textContent = "ESP32: Bağlı";
    elEspText.className = "text-xs font-mono text-emerald-400";
    
    if (prevState.espConnected !== true) {
        if (prevState.espConnected !== null) {
            addLogEntry("CIHAZ", "ESP32 donanım ünitesi bağlandı, veri akışı aktif.", "success");
        }
        prevState.espConnected = true;
    }
    
    try {
        const data = jsonParseSafe(payloadStr);
        if (!data) return;
        
        const co = data.co_raw;
        const air = data.air_raw;
        const pm = data.pm25_raw;
        const fan = data.fan;
        const override = data.override;
        
        // Update UI raw value numbers
        elCoVal.textContent = co;
        elAirVal.textContent = air;
        elPmVal.textContent = pm;
        
        // Update progress bars widths
        // Max range for analog is 4095
        const coPercent = Math.min(100, (co / 4095) * 100);
        const airPercent = Math.min(100, (air / 4095) * 100);
        const pmPercent = Math.min(100, (pm / 4095) * 100);
        
        elCoProgress.style.width = coPercent + "%";
        elAirProgress.style.width = airPercent + "%";
        elPmProgress.style.width = pmPercent + "%";
        
        // Update progress colors
        // CO limits: Warning at 900, danger at 1200
        setProgressColor(elCoProgress, co, 900, 1200);
        setProgressColor(elAirProgress, air, 2000, 2000);
        setProgressColor(elPmProgress, pm, 2000, 2000);
        
        // Keep track of charts history
        const now = new Date();
        const timeStr = now.toLocaleTimeString('tr-TR', { hour12: false });
        
        historyData.timestamps.push(timeStr);
        historyData.co.push(co);
        historyData.air.push(air);
        historyData.pm.push(pm);
        
        if (historyData.timestamps.length > MAX_HISTORY_POINTS) {
            historyData.timestamps.shift();
            historyData.co.shift();
            historyData.air.shift();
            historyData.pm.shift();
        }
        
        updateChart();
        
        // Update Fan UI status
        if (fan) {
            elFanIcon.className = "fa-solid fa-fan text-emerald-400 text-lg spin-fast";
            elFanIconBg.className = "w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30";
            elFanStatusText.textContent = "AÇIK";
            elFanStatusText.className = "text-sm font-bold text-emerald-400";
        } else {
            elFanIcon.className = "fa-solid fa-fan text-gray-400 text-lg";
            elFanIconBg.className = "w-10 h-10 rounded-lg bg-gray-800/80 flex items-center justify-center";
            elFanStatusText.textContent = "KAPALI";
            elFanStatusText.className = "text-sm font-bold text-gray-500";
        }
        
        // Update Override Badge
        updateButtonsUI(override);
        
        // Event Logging on Transitions
        if (prevState.fan !== null && prevState.fan !== fan) {
            const eventMsg = fan ? "Havalandırma fanı çalıştırıldı." : "Havalandırma fanı durduruldu.";
            const category = fan ? "FAN AÇILDI" : "FAN KAPANDI";
            const level = fan ? "success" : "info";
            addLogEntry(category, eventMsg, level);
        }
        prevState.fan = fan;
        
    } catch (e) {
        console.error("Telemetry parsing error", e);
    }
}

// 7. Handle Incoming AI Analysis JSON
function handleAiAnalysis(payloadStr) {
    try {
        const data = jsonParseSafe(payloadStr);
        if (!data) return;
        
        const score = data.risk_score;
        const label = data.risk_label;
        const commentary = data.commentary;
        const faults = data.faults || [];
        const early_fan = data.early_fan || false;
        
        // Update Risk Gauge conic gradient
        let scoreColor = "#10b981"; // Safe (Green)
        let badgeStyle = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
        let level = "info";
        
        if (score >= 30 && score < 60) {
            scoreColor = "#f59e0b"; // Attention (Amber/Yellow)
            badgeStyle = "bg-amber-500/10 text-amber-400 border-amber-500/20";
            level = "warning";
        } else if (score >= 60 && score < 80) {
            scoreColor = "#f97316"; // Risky (Orange)
            badgeStyle = "bg-orange-500/10 text-orange-400 border-orange-500/20";
            level = "warning";
        } else if (score >= 80) {
            scoreColor = "#ef4444"; // Emergency (Red)
            badgeStyle = "bg-red-500/10 text-red-400 border-red-500/20 animate-pulse";
            level = "danger";
        }
        
        elRiskNum.textContent = score;
        elRiskBadge.textContent = label;
        elRiskBadge.className = `text-xs font-bold font-mono tracking-wider px-3 py-1 rounded-full mt-3 border uppercase ${badgeStyle}`;
        
        // CSS conic-gradient dynamic mask mapping
        elRiskGauge.style.background = `conic-gradient(${scoreColor} 0% ${score}%, #1a1e2f ${score}% 100%)`;
        
        // Update commentary card
        elAiComment.textContent = commentary;
        
        // Update Sensors trends icons/badges
        updateTrendIndicator(elCoTrendText, elCoTrendIcon, elCoTrendCont, data.co_trend, data.co_slope);
        updateTrendIndicator(elAirTrendText, elAirTrendIcon, elAirTrendCont, data.air_trend, data.air_slope);
        updateTrendIndicator(elPmTrendText, elPmTrendIcon, elPmTrendCont, data.pm_trend, data.pm_slope);
        
        // Update Anomaly banner
        if (faults.length > 0) {
            elFaultBanner.classList.remove("hidden");
            elFaultBannerText.innerHTML = faults.map(f => `• ${f}`).join("<br>");
            
            if (prevState.faultsCount === 0) {
                addLogEntry("ARIZA TESPİTİ", `Kritik donanım arızası! (${faults[0]})`, "fault");
            }
        } else {
            elFaultBanner.classList.add("hidden");
            if (prevState.faultsCount > 0) {
                addLogEntry("SENSÖR DÜZELDİ", "Donanım arızaları giderildi, sensör okumaları stabil.", "success");
            }
        }
        prevState.faultsCount = faults.length;

        // Change mode badge based on early AI trigger status
        if (early_fan) {
            elFanModeBadge.textContent = "ERKEN AKTİF (AI)";
            elFanModeBadge.className = "text-xs font-bold text-orange-400 bg-orange-950/30 px-2 py-0.5 rounded border border-orange-800/30 mt-0.5 inline-block";
            
            if (prevState.earlyFan !== true) {
                addLogEntry("YAPAY ZEKA", "Değerlerdeki hızlı artış trendi sebebiyle fan ERKEN çalıştırıldı.", "ai");
                prevState.earlyFan = true;
            }
        } else {
            prevState.earlyFan = false;
        }
        
        // Risk State transition logging
        if (prevState.risk !== null && prevState.risk !== label) {
            const riskMsg = `Genel ortam riski ${prevState.risk} seviyesinden ${label} seviyesine geçti (Puan: ${score}).`;
            addLogEntry("RİSK DEĞİŞİMİ", riskMsg, level);
        }
        prevState.risk = label;
        
    } catch (e) {
        console.error("AI Analysis parsing error", e);
    }
}

// 8. Helper Functions
function jsonParseSafe(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return null;
    }
}

function setProgressColor(element, value, warning, danger) {
    if (value >= danger) {
        element.className = "bg-red-500 h-full w-[0%] transition-all duration-500";
    } else if (value >= warning) {
        element.className = "bg-amber-500 h-full w-[0%] transition-all duration-500";
    } else {
        element.className = "bg-emerald-500 h-full w-[0%] transition-all duration-500";
    }
}

function updateTrendIndicator(textEl, iconEl, containerEl, trend, slope) {
    if (trend === "Artıyor") {
        textEl.textContent = `Artıyor (+${slope})`;
        containerEl.className = "flex items-center gap-1.5 mt-3 text-xs text-red-400 font-semibold";
        iconEl.className = "fa-solid fa-arrow-trend-up text-red-400";
    } else if (trend === "Azalıyor") {
        textEl.textContent = `Düşüyor (${slope})`;
        containerEl.className = "flex items-center gap-1.5 mt-3 text-xs text-emerald-400";
        iconEl.className = "fa-solid fa-arrow-trend-down text-emerald-400";
    } else {
        textEl.textContent = "Kararlı (0.0)";
        containerEl.className = "flex items-center gap-1.5 mt-3 text-xs text-gray-500";
        iconEl.className = "fa-solid fa-circle-check text-gray-500";
    }
}

function updateButtonsUI(override) {
    if (override === "manual" && prevState.fan) {
        // Force Active manual ON button
        setActiveButton(btnFanOn);
        elFanModeBadge.textContent = "MANUEL AÇIK";
        elFanModeBadge.className = "text-xs font-bold text-red-400 bg-red-950/30 px-2 py-0.5 rounded border border-red-800/30 mt-0.5 inline-block";
    } else if (override === "manual" && !prevState.fan) {
        // Force Active manual OFF button
        setActiveButton(btnFanOff);
        elFanModeBadge.textContent = "MANUEL KAPALI";
        elFanModeBadge.className = "text-xs font-bold text-gray-400 bg-gray-900/50 px-2 py-0.5 rounded border border-white/5 mt-0.5 inline-block";
    } else {
        // Automatic mode
        setActiveButton(btnFanAuto);
        if (!prevState.earlyFan) {
            elFanModeBadge.textContent = "OTOMATİK (AI)";
            elFanModeBadge.className = "text-xs font-bold text-cyan-400 bg-cyan-950/30 px-2 py-0.5 rounded border border-cyan-800/30 mt-0.5 inline-block";
        }
    }
    
    if (prevState.override !== null && prevState.override !== override) {
        const overrideMsg = override === "manual" ? `Cihaz çalışma modu MANUEL olarak değiştirildi (Fan: ${prevState.fan ? 'AÇIK' : 'KAPALI'}).` : "Cihaz kontrolü OTOMATİK (Yapay Zeka) moda geçirildi.";
        addLogEntry("KONTROL MODU", overrideMsg, override === "manual" ? "warning" : "success");
    }
    prevState.override = override;
}

function setActiveButton(activeBtn) {
    [btnFanOn, btnFanOff, btnFanAuto].forEach(btn => {
        if (btn === activeBtn) {
            btn.className = "btn-control active py-3 px-2 rounded-xl text-center flex flex-col items-center gap-1.5 transition-all duration-200";
            if (btn === btnFanOn) btn.className += " bg-emerald-500/10 text-emerald-400 border border-emerald-500/30";
            else if (btn === btnFanOff) btn.className += " bg-red-500/10 text-red-400 border border-red-500/30";
            else btn.className += " bg-cyan-500/10 text-cyan-400 border border-cyan-500/30";
        } else {
            btn.className = "btn-control py-3 px-2 rounded-xl text-center flex flex-col items-center gap-1.5 transition-all duration-200 bg-white/5 hover:bg-white/10 text-gray-400 border border-white/5";
        }
    });
}

// 9. Button Publish Actions
function publishCommand(command) {
    if (!mqttClient || !mqttClient.isConnected()) {
        addLogEntry("HATA", "Broker sunucusuna bağlı değilsiniz! Komut gönderilemedi.", "fault");
        return;
    }
    
    const message = new Paho.MQTT.Message(command);
    message.destinationName = TOPIC_COMMAND;
    message.retained = false;
    
    mqttClient.send(message);
    console.log("MQTT Command Sent: ", command);
    addLogEntry("TETİKLEME", `Sunucuya fan override komutu gönderildi: ${command}`, "info");
}

btnFanOn.addEventListener("click", () => {
    publishCommand("FAN_ON");
    setActiveButton(btnFanOn);
});

btnFanOff.addEventListener("click", () => {
    publishCommand("FAN_OFF");
    setActiveButton(btnFanOff);
});

btnFanAuto.addEventListener("click", () => {
    publishCommand("FAN_AUTO");
    setActiveButton(btnFanAuto);
});


// Initialization
window.addEventListener("DOMContentLoaded", () => {
    initChart();
    selectTab("co");
    connectMqtt();
    startWatchdog();
});
