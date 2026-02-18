/*
 * Process Service - Fetches and manages process data using cockpit.spawn
 */

import cockpit from 'cockpit';
import type { ProcessInfo } from './types';

/* Track previous per-process I/O bytes for rate calculation */
let prevIoStats: Record<number, { read: number; write: number; timestamp: number }> = {};

/**
 * Batch-read /proc/[pid]/io for all processes and return cumulative bytes.
 * Uses a single shell command for efficiency.
 */
async function fetchProcessIo(): Promise<Record<number, { readBytes: number; writeBytes: number }>> {
    const result: Record<number, { readBytes: number; writeBytes: number }> = {};
    try {
        const output = await cockpit.spawn(
            ['sh', '-c', 'grep -H "^read_bytes\\|^write_bytes" /proc/[0-9]*/io 2>/dev/null'],
            { superuser: 'try', err: 'ignore' }
        );
        // Lines like: /proc/1234/io:read_bytes: 56789
        for (const line of output.trim().split('\n')) {
            if (!line) continue;
            const match = line.match(/\/proc\/(\d+)\/io:(read_bytes|write_bytes):\s*(\d+)/);
            if (match) {
                const pid = parseInt(match[1], 10);
                const val = parseInt(match[3], 10);
                if (!result[pid]) result[pid] = { readBytes: 0, writeBytes: 0 };
                if (match[2] === 'read_bytes') result[pid].readBytes = val;
                else result[pid].writeBytes = val;
            }
        }
    } catch { /* best-effort: some processes may not be readable */ }
    return result;
}

/**
 * Fetch all running processes with resource usage.
 * Uses a single `ps` command + batch /proc/[pid]/io read.
 */
export async function fetchProcesses(): Promise<ProcessInfo[]> {
    try {
        const [output, ioData] = await Promise.all([
            cockpit.spawn(
                ['ps', 'axo', 'pid,ppid,user,%cpu,%mem,rss,nlwp,ni,stat,etime,comm,args',
                    '--no-headers', '--sort=-pcpu'],
                { superuser: 'try', err: 'ignore' }
            ),
            fetchProcessIo(),
        ]);

        const now = Date.now();
        const processes: ProcessInfo[] = [];
        for (const line of output.trim().split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const parts = trimmed.split(/\s+/);
            if (parts.length < 12) continue;

            const pid = parseInt(parts[0], 10);
            if (isNaN(pid)) continue;

            // Compute disk I/O rates from /proc/[pid]/io deltas
            let diskRead = 0;
            let diskWrite = 0;
            const io = ioData[pid];
            if (io && prevIoStats[pid]) {
                const dt = (now - prevIoStats[pid].timestamp) / 1000;
                if (dt > 0) {
                    diskRead = Math.max(0, (io.readBytes - prevIoStats[pid].read) / 1024 / dt);
                    diskWrite = Math.max(0, (io.writeBytes - prevIoStats[pid].write) / 1024 / dt);
                }
            }
            if (io) {
                prevIoStats[pid] = { read: io.readBytes, write: io.writeBytes, timestamp: now };
            }

            processes.push({
                pid,
                ppid: parseInt(parts[1], 10) || 0,
                user: parts[2] || '',
                name: parts[10] || '',
                cmdline: parts.slice(11).join(' ') || parts[10] || '',
                state: parts[8] || '',
                cpu: parseFloat(parts[3]) || 0,
                memory: parseFloat(parts[4]) || 0,
                memoryRss: parseInt(parts[5], 10) || 0,
                threads: parseInt(parts[6], 10) || 0,
                nice: parseInt(parts[7], 10) || 0,
                startTime: parts[9] || '',
                diskRead,
                diskWrite,
            });
        }

        // Clean up stale entries from prevIoStats for exited processes
        const activePids = new Set(processes.map(p => p.pid));
        for (const pid of Object.keys(prevIoStats)) {
            if (!activePids.has(Number(pid))) delete prevIoStats[Number(pid)];
        }

        return processes;
    } catch (err) {
        console.error('Failed to fetch processes:', err);
        return [];
    }
}

/**
 * Send a signal to a process
 */
export async function killProcess(pid: number, signal: string = 'TERM'): Promise<{ success: boolean; error?: string }> {
    try {
        await cockpit.spawn(['kill', `-${signal}`, String(pid)], { superuser: 'try', err: 'message' });
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message || String(err) };
    }
}
