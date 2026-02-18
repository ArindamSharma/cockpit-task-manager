/*
 * Task Manager Types
 */

export interface ProcessInfo {
    pid: number;
    ppid: number;
    user: string;
    name: string;
    cmdline: string;
    state: string;
    cpu: number;       // percentage
    memory: number;    // percentage
    memoryRss: number; // KB
    threads: number;
    nice: number;
    startTime: string;
    diskRead: number;  // KB/s
    diskWrite: number; // KB/s
}

export interface HardwareInfo {
    cpuModel: string;
    cpuFreqMHz: string;
    diskDevices: { name: string; sizeGB: string }[];
    networkInterfaces: { name: string; speed: string }[];
    gpus: GpuDevice[];
}

export interface GpuDevice {
    index: number;
    name: string;
    vendor: 'nvidia' | 'amd' | 'intel' | 'unknown';
}

export interface GpuStats {
    gpuUsage: number;       // percentage
    memoryUsage: number;    // percentage
    memoryTotal: number;    // MB
    memoryUsed: number;     // MB
    temperature: number;    // Celsius, -1 if unavailable
    powerDraw: number;      // Watts, -1 if unavailable
}

export interface SystemStats {
    cpuUsage: number;        // overall percentage
    cpuCores: number;
    cpuPerCore: number[];
    memoryTotal: number;     // KB
    memoryUsed: number;      // KB
    memoryFree: number;      // KB
    memoryCached: number;    // KB
    swapTotal: number;       // KB
    swapUsed: number;        // KB
    diskReadRate: number;    // KB/s
    diskWriteRate: number;   // KB/s
    perDiskStats: Record<string, { readRate: number; writeRate: number }>;
    networkSentRate: number; // KB/s
    networkRecvRate: number; // KB/s
    perIfaceStats: Record<string, { sentRate: number; recvRate: number }>;
    uptime: string;
    loadAvg: number[];
}

export type SortField = 'pid' | 'name' | 'user' | 'cpu' | 'memory' | 'memoryRss' | 'diskRead' | 'diskWrite' | 'state' | 'threads';
export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
    field: SortField;
    direction: SortDirection;
}

export interface HistoryPoint {
    timestamp: number;
    value: number;
}

export interface SystemHistory {
    cpu: HistoryPoint[];
    memory: HistoryPoint[];
    diskRead: HistoryPoint[];
    diskWrite: HistoryPoint[];
    networkSent: HistoryPoint[];
    networkRecv: HistoryPoint[];
}
