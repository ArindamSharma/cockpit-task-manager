/*
 * System Stats Service - Fetches system-wide resource usage with per-disk tracking
 */

import cockpit from 'cockpit';
import type { SystemStats, SystemHistory, HistoryPoint, HardwareInfo, GpuStats, GpuDevice } from './types';

const MAX_HISTORY_POINTS = 60;

let prevCpuTimes: number[] | null = null;
let prevPerCoreTimes: number[][] | null = null;
let prevNetStats: { sent: number; recv: number; timestamp: number } | null = null;
let prevPerIfaceStats: Record<string, { sent: number; recv: number; timestamp: number }> = {};
let prevDiskStats: { read: number; write: number; timestamp: number } | null = null;
let prevPerDiskStats: Record<string, { read: number; write: number; timestamp: number }> = {};

const history: SystemHistory = {
    cpu: [], memory: [], diskRead: [], diskWrite: [], networkSent: [], networkRecv: [],
};

const perDiskHistories: Record<string, { read: HistoryPoint[]; write: HistoryPoint[] }> = {};
const perIfaceHistories: Record<string, { sent: HistoryPoint[]; recv: HistoryPoint[] }> = {};
const perCoreHistories: Record<number, HistoryPoint[]> = {};
const gpuHistories: Record<number, { usage: HistoryPoint[]; memory: HistoryPoint[] }> = {};

function addHistoryPoint(arr: HistoryPoint[], value: number) {
    arr.push({ timestamp: Date.now(), value });
    if (arr.length > MAX_HISTORY_POINTS) arr.shift();
}

function parseCpuLine(line: string): number[] {
    return line.trim().split(/\s+/).slice(1).map(Number);
}

/**
 * Fetch hardware info once at startup (CPU model, disks, network interfaces)
 */
export async function fetchHardwareInfo(): Promise<HardwareInfo> {
    const info: HardwareInfo = { cpuModel: '', cpuFreqMHz: '', diskDevices: [], networkInterfaces: [], gpus: [] };
    try {
        const [cpuinfo, lsblk, netDir] = await Promise.all([
            cockpit.file('/proc/cpuinfo').read().catch(() => ''),
            cockpit.spawn(['lsblk', '-dno', 'NAME,SIZE,TYPE'], { err: 'ignore' }).catch(() => ''),
            cockpit.spawn(['ls', '/sys/class/net'], { err: 'ignore' }).catch(() => ''),
        ]);

        if (cpuinfo) {
            const modelMatch = cpuinfo.match(/model name\s*:\s*(.+)/);
            info.cpuModel = modelMatch ? modelMatch[1].trim() : '';
            const freqMatch = cpuinfo.match(/cpu MHz\s*:\s*([\d.]+)/);
            info.cpuFreqMHz = freqMatch ? `${parseFloat(freqMatch[1]).toFixed(0)} MHz` : '';
        }

        if (lsblk) {
            for (const line of lsblk.trim().split('\n')) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 3 && parts[2] === 'disk') {
                    info.diskDevices.push({ name: parts[0], sizeGB: parts[1] });
                }
            }
        }

        if (netDir) {
            const ifaces = netDir.trim().split(/\s+/).filter(n => n !== 'lo');
            const speeds = await Promise.all(
                ifaces.map(iface =>
                    cockpit.file(`/sys/class/net/${iface}/speed`).read().catch(() => null)
                )
            );
            info.networkInterfaces = ifaces.map((name, i) => {
                const raw = speeds[i]?.trim();
                const mbps = raw && !isNaN(Number(raw)) && Number(raw) > 0 ? `${raw} Mbps` : '';
                return { name, speed: mbps };
            });
        }

        // === GPU Detection ===
        info.gpus = await detectGpus();
    } catch { /* best-effort */ }
    return info;
}

/**
 * Detect available GPUs (NVIDIA via nvidia-smi, AMD/Intel via sysfs)
 */
async function detectGpus(): Promise<GpuDevice[]> {
    const gpus: GpuDevice[] = [];
    try {
        // Try NVIDIA first
        const nvOut = await cockpit.spawn(
            ['nvidia-smi', '--query-gpu=index,name', '--format=csv,noheader,nounits'],
            { err: 'ignore' }
        ).catch(() => '');
        if (nvOut && nvOut.trim()) {
            for (const line of nvOut.trim().split('\n')) {
                const parts = line.split(',').map(s => s.trim());
                if (parts.length >= 2) {
                    gpus.push({ index: parseInt(parts[0], 10), name: parts[1], vendor: 'nvidia' });
                }
            }
        }
    } catch { /* nvidia-smi not available */ }

    if (gpus.length === 0) {
        try {
            // Try AMD via sysfs
            const drmCards = await cockpit.spawn(['sh', '-c', 'ls -d /sys/class/drm/card[0-9]* 2>/dev/null'], { err: 'ignore' }).catch(() => '');
            if (drmCards && drmCards.trim()) {
                for (const cardPath of drmCards.trim().split('\n')) {
                    const card = cardPath.trim();
                    const busyFile = `${card}/device/gpu_busy_percent`;
                    const exists = await cockpit.spawn(['test', '-f', busyFile], { err: 'ignore' }).then(() => true).catch(() => false);
                    if (exists) {
                        const cardNum = card.match(/card(\d+)/)?.[1] || '0';
                        const vendorId = await cockpit.file(`${card}/device/vendor`).read().catch(() => '');
                        const vendor = vendorId?.trim() === '0x1002' ? 'amd' as const : 'intel' as const;
                        const devName = await cockpit.file(`${card}/device/product_name`).read().catch(() => null)
                            ?? await cockpit.spawn(['sh', '-c', `lspci -s $(basename $(readlink ${card}/device)) 2>/dev/null | sed 's/.*: //'`], { err: 'ignore' }).catch(() => null);
                        gpus.push({
                            index: parseInt(cardNum, 10),
                            name: devName?.trim() || `GPU ${cardNum}`,
                            vendor,
                        });
                    }
                }
            }
        } catch { /* no AMD/Intel GPU sysfs */ }
    }
    return gpus;
}

/**
 * Fetch GPU stats for all detected GPUs (called every refresh)
 */
export async function fetchGpuStats(gpus: GpuDevice[]): Promise<GpuStats[]> {
    if (gpus.length === 0) return [];
    const results: GpuStats[] = [];

    // Try NVIDIA
    const hasNvidia = gpus.some(g => g.vendor === 'nvidia');
    if (hasNvidia) {
        try {
            const out = await cockpit.spawn(
                ['nvidia-smi', '--query-gpu=index,utilization.gpu,utilization.memory,memory.total,memory.used,temperature.gpu,power.draw',
                    '--format=csv,noheader,nounits'],
                { err: 'ignore' }
            );
            if (out && out.trim()) {
                for (const line of out.trim().split('\n')) {
                    const p = line.split(',').map(s => s.trim());
                    if (p.length >= 7) {
                        const idx = parseInt(p[0], 10);
                        const gpuUsage = parseFloat(p[1]) || 0;
                        const memUsage = parseFloat(p[2]) || 0;
                        const memTotal = parseFloat(p[3]) || 0;
                        const memUsed = parseFloat(p[4]) || 0;
                        const temp = parseFloat(p[5]);
                        const power = parseFloat(p[6]);
                        const stat: GpuStats = {
                            gpuUsage, memoryUsage: memUsage, memoryTotal: memTotal, memoryUsed: memUsed,
                            temperature: isNaN(temp) ? -1 : temp, powerDraw: isNaN(power) ? -1 : power,
                        };
                        results.push(stat);
                        if (!gpuHistories[idx]) gpuHistories[idx] = { usage: [], memory: [] };
                        addHistoryPoint(gpuHistories[idx].usage, gpuUsage);
                        addHistoryPoint(gpuHistories[idx].memory, memUsage);
                    }
                }
            }
        } catch { /* nvidia-smi failed */ }
    }

    // Try AMD/Intel sysfs
    const sysfsGpus = gpus.filter(g => g.vendor === 'amd' || g.vendor === 'intel');
    for (const gpu of sysfsGpus) {
        try {
            const cardBase = `/sys/class/drm/card${gpu.index}/device`;
            const [busyStr, vramTotal, vramUsed, tempStr] = await Promise.all([
                cockpit.file(`${cardBase}/gpu_busy_percent`).read().catch(() => '0'),
                cockpit.file(`${cardBase}/mem_info_vram_total`).read().catch(() => '0'),
                cockpit.file(`${cardBase}/mem_info_vram_used`).read().catch(() => '0'),
                cockpit.spawn(['sh', '-c', `cat ${cardBase}/hwmon/hwmon*/temp1_input 2>/dev/null | head -1`], { err: 'ignore' }).catch(() => ''),
            ]);
            const gpuUsage = parseInt(busyStr?.trim() || '0', 10);
            const memTotalBytes = parseInt(vramTotal?.trim() || '0', 10);
            const memUsedBytes = parseInt(vramUsed?.trim() || '0', 10);
            const memTotalMB = memTotalBytes / (1024 * 1024);
            const memUsedMB = memUsedBytes / (1024 * 1024);
            const memUsage = memTotalMB > 0 ? (memUsedMB / memTotalMB) * 100 : 0;
            const temp = tempStr?.trim() ? parseInt(tempStr.trim(), 10) / 1000 : -1;
            results.push({
                gpuUsage, memoryUsage: memUsage, memoryTotal: memTotalMB, memoryUsed: memUsedMB,
                temperature: temp, powerDraw: -1,
            });
            if (!gpuHistories[gpu.index]) gpuHistories[gpu.index] = { usage: [], memory: [] };
            addHistoryPoint(gpuHistories[gpu.index].usage, gpuUsage);
            addHistoryPoint(gpuHistories[gpu.index].memory, memUsage);
        } catch { /* sysfs read failed */ }
    }

    return results;
}

export function getGpuHistory(): Record<number, { usage: HistoryPoint[]; memory: HistoryPoint[] }> {
    const result: Record<number, { usage: HistoryPoint[]; memory: HistoryPoint[] }> = {};
    for (const [idx, hist] of Object.entries(gpuHistories)) {
        result[Number(idx)] = { usage: [...hist.usage], memory: [...hist.memory] };
    }
    return result;
}

/**
 * Fetch system statistics from /proc (called every refresh)
 */
export async function fetchSystemStats(): Promise<SystemStats> {
    const stats: SystemStats = {
        cpuUsage: 0, cpuCores: 1, cpuPerCore: [],
        memoryTotal: 0, memoryUsed: 0, memoryFree: 0, memoryCached: 0,
        swapTotal: 0, swapUsed: 0,
        diskReadRate: 0, diskWriteRate: 0, perDiskStats: {},
        networkSentRate: 0, networkRecvRate: 0, perIfaceStats: {},
        uptime: '', loadAvg: [0, 0, 0],
    };

    try {
        const [statContent, meminfoContent, uptimeContent, loadavgContent, diskstatsContent, netContent] = await Promise.all([
            cockpit.file('/proc/stat').read(),
            cockpit.file('/proc/meminfo').read(),
            cockpit.file('/proc/uptime').read(),
            cockpit.file('/proc/loadavg').read(),
            cockpit.file('/proc/diskstats').read(),
            cockpit.file('/proc/net/dev').read(),
        ]);

        // === CPU ===
        if (statContent) {
            const lines = statContent.split('\n');
            const cpuTotal = parseCpuLine(lines[0]);
            const coreLines = lines.filter(l => /^cpu\d+/.test(l));
            stats.cpuCores = coreLines.length || 1;

            if (prevCpuTimes) {
                const totalDelta = cpuTotal.reduce((a, b) => a + b, 0) - prevCpuTimes.reduce((a, b) => a + b, 0);
                const idleDelta = (cpuTotal[3] + (cpuTotal[4] || 0)) - (prevCpuTimes[3] + (prevCpuTimes[4] || 0));
                stats.cpuUsage = totalDelta > 0 ? Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100)) : 0;
            }
            prevCpuTimes = cpuTotal;

            const currentCoreTimes = coreLines.map(parseCpuLine);
            if (prevPerCoreTimes && prevPerCoreTimes.length === currentCoreTimes.length) {
                stats.cpuPerCore = currentCoreTimes.map((core, i) => {
                    const prev = prevPerCoreTimes![i];
                    const total = core.reduce((a, b) => a + b, 0) - prev.reduce((a, b) => a + b, 0);
                    const idle = (core[3] + (core[4] || 0)) - (prev[3] + (prev[4] || 0));
                    return total > 0 ? Math.max(0, Math.min(100, ((total - idle) / total) * 100)) : 0;
                });
            } else {
                stats.cpuPerCore = new Array(stats.cpuCores).fill(0);
            }
            prevPerCoreTimes = currentCoreTimes;

            // Per-core history
            stats.cpuPerCore.forEach((usage, i) => {
                if (!perCoreHistories[i]) perCoreHistories[i] = [];
                addHistoryPoint(perCoreHistories[i], usage);
            });
        }

        // === Memory ===
        if (meminfoContent) {
            const getVal = (key: string): number => {
                const match = meminfoContent.match(new RegExp(`${key}:\\s*(\\d+)`));
                return match ? parseInt(match[1], 10) : 0;
            };
            stats.memoryTotal = getVal('MemTotal');
            stats.memoryFree = getVal('MemFree');
            stats.memoryCached = getVal('Cached') + getVal('Buffers') + getVal('SReclaimable');
            stats.memoryUsed = stats.memoryTotal - stats.memoryFree - stats.memoryCached;
            stats.swapTotal = getVal('SwapTotal');
            stats.swapUsed = stats.swapTotal - getVal('SwapFree');
        }

        // === Uptime ===
        if (uptimeContent) {
            const secs = parseFloat(uptimeContent.split(' ')[0]);
            const days = Math.floor(secs / 86400);
            const hours = Math.floor((secs % 86400) / 3600);
            const mins = Math.floor((secs % 3600) / 60);
            stats.uptime = days > 0 ? `${days}d ${hours}h ${mins}m` : `${hours}h ${mins}m`;
        }

        // === Load ===
        if (loadavgContent) {
            stats.loadAvg = loadavgContent.split(' ').slice(0, 3).map(Number);
        }

        // === Disk I/O (aggregate + per-device) ===
        if (diskstatsContent) {
            const now = Date.now();
            let totalRead = 0, totalWrite = 0;
            const currentPerDisk: Record<string, { read: number; write: number }> = {};

            for (const line of diskstatsContent.split('\n')) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 14) {
                    const devName = parts[2];
                    if (/^(sd|nvme|vd|xvd|hd)[a-z]/.test(devName) && !/\d+$/.test(devName)) {
                        const read = parseInt(parts[5], 10) * 512;
                        const write = parseInt(parts[9], 10) * 512;
                        totalRead += read;
                        totalWrite += write;
                        currentPerDisk[devName] = { read, write };
                    }
                }
            }

            // Aggregate rates
            if (prevDiskStats) {
                const dt = (now - prevDiskStats.timestamp) / 1000;
                if (dt > 0) {
                    stats.diskReadRate = Math.max(0, (totalRead - prevDiskStats.read) / 1024 / dt);
                    stats.diskWriteRate = Math.max(0, (totalWrite - prevDiskStats.write) / 1024 / dt);
                }
            }
            prevDiskStats = { read: totalRead, write: totalWrite, timestamp: now };

            // Per-device rates + history
            for (const [dev, cur] of Object.entries(currentPerDisk)) {
                if (prevPerDiskStats[dev]) {
                    const dt = (now - prevPerDiskStats[dev].timestamp) / 1000;
                    if (dt > 0) {
                        const readRate = Math.max(0, (cur.read - prevPerDiskStats[dev].read) / 1024 / dt);
                        const writeRate = Math.max(0, (cur.write - prevPerDiskStats[dev].write) / 1024 / dt);
                        stats.perDiskStats[dev] = { readRate, writeRate };

                        if (!perDiskHistories[dev]) perDiskHistories[dev] = { read: [], write: [] };
                        addHistoryPoint(perDiskHistories[dev].read, readRate);
                        addHistoryPoint(perDiskHistories[dev].write, writeRate);
                    }
                }
                prevPerDiskStats[dev] = { read: cur.read, write: cur.write, timestamp: now };
            }
        }

        // === Network ===
        if (netContent) {
            const now = Date.now();
            let totalSent = 0, totalRecv = 0;
            const currentPerIface: Record<string, { sent: number; recv: number }> = {};
            for (const line of netContent.split('\n').slice(2)) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 10) {
                    const iface = parts[0].replace(':', '');
                    if (iface === 'lo') continue;
                    const recv = parseInt(parts[1], 10);
                    const sent = parseInt(parts[9], 10);
                    totalRecv += recv;
                    totalSent += sent;
                    currentPerIface[iface] = { sent, recv };
                }
            }
            if (prevNetStats) {
                const dt = (now - prevNetStats.timestamp) / 1000;
                if (dt > 0) {
                    stats.networkSentRate = Math.max(0, (totalSent - prevNetStats.sent) / 1024 / dt);
                    stats.networkRecvRate = Math.max(0, (totalRecv - prevNetStats.recv) / 1024 / dt);
                }
            }
            prevNetStats = { sent: totalSent, recv: totalRecv, timestamp: now };

            // Per-interface rates + history
            for (const [iface, cur] of Object.entries(currentPerIface)) {
                if (prevPerIfaceStats[iface]) {
                    const dt = (now - prevPerIfaceStats[iface].timestamp) / 1000;
                    if (dt > 0) {
                        const sentRate = Math.max(0, (cur.sent - prevPerIfaceStats[iface].sent) / 1024 / dt);
                        const recvRate = Math.max(0, (cur.recv - prevPerIfaceStats[iface].recv) / 1024 / dt);
                        stats.perIfaceStats[iface] = { sentRate, recvRate };

                        if (!perIfaceHistories[iface]) perIfaceHistories[iface] = { sent: [], recv: [] };
                        addHistoryPoint(perIfaceHistories[iface].sent, sentRate);
                        addHistoryPoint(perIfaceHistories[iface].recv, recvRate);
                    }
                }
                prevPerIfaceStats[iface] = { sent: cur.sent, recv: cur.recv, timestamp: now };
            }
        }
    } catch (err) {
        console.error('Failed to fetch system stats:', err);
    }

    // Update history
    addHistoryPoint(history.cpu, stats.cpuUsage);
    addHistoryPoint(history.memory, stats.memoryTotal > 0 ? (stats.memoryUsed / stats.memoryTotal) * 100 : 0);
    addHistoryPoint(history.diskRead, stats.diskReadRate);
    addHistoryPoint(history.diskWrite, stats.diskWriteRate);
    addHistoryPoint(history.networkSent, stats.networkSentRate);
    addHistoryPoint(history.networkRecv, stats.networkRecvRate);

    return stats;
}

export function getSystemHistory(): SystemHistory {
    return { ...history };
}

export function getPerDiskHistory(): Record<string, { read: HistoryPoint[]; write: HistoryPoint[] }> {
    const result: Record<string, { read: HistoryPoint[]; write: HistoryPoint[] }> = {};
    for (const [dev, hist] of Object.entries(perDiskHistories)) {
        result[dev] = { read: [...hist.read], write: [...hist.write] };
    }
    return result;
}

export function getPerIfaceHistory(): Record<string, { sent: HistoryPoint[]; recv: HistoryPoint[] }> {
    const result: Record<string, { sent: HistoryPoint[]; recv: HistoryPoint[] }> = {};
    for (const [iface, hist] of Object.entries(perIfaceHistories)) {
        result[iface] = { sent: [...hist.sent], recv: [...hist.recv] };
    }
    return result;
}

export function getPerCoreHistory(): Record<number, HistoryPoint[]> {
    const result: Record<number, HistoryPoint[]> = {};
    for (const [core, hist] of Object.entries(perCoreHistories)) {
        result[Number(core)] = [...hist];
    }
    return result;
}

export function formatBytes(kb: number, decimals: number = 1): string {
    if (kb === 0) return '0 KB';
    if (kb < 1024) return `${kb.toFixed(decimals)} KB`;
    if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(decimals)} MB`;
    return `${(kb / 1024 / 1024).toFixed(decimals)} GB`;
}

export function formatRate(kbPerSec: number): string {
    if (kbPerSec < 1) return `${(kbPerSec * 1024).toFixed(0)} B/s`;
    if (kbPerSec < 1024) return `${kbPerSec.toFixed(1)} KB/s`;
    return `${(kbPerSec / 1024).toFixed(1)} MB/s`;
}
