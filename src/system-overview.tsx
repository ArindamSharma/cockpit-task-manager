/*
 * SystemOverview - CPU, Memory, Disk, Network cards with per-disk selection (inline styles only)
 */

import React, { useState } from 'react';
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Grid, GridItem } from "@patternfly/react-core/dist/esm/layouts/Grid/index.js";
import { Dropdown, DropdownItem, DropdownList } from "@patternfly/react-core/dist/esm/components/Dropdown/index.js";
import { MenuToggle } from "@patternfly/react-core/dist/esm/components/MenuToggle/index.js";

import { UsageGraph } from './usage-graph';
import { formatBytes, formatRate } from './system-stats-service';
import type { SystemStats, SystemHistory, HardwareInfo, HistoryPoint, GpuStats } from './types';

import cockpit from 'cockpit';

const _ = cockpit.gettext as unknown as (s: string, ...args: any[]) => string;

/* Shared inline styles */
const cardTitleStyle: React.CSSProperties = {
    fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', paddingBottom: 4,
};
const statRowStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: '0.8rem',
    borderBottom: '1px solid var(--pf-t--global--border--color--default)',
};
const statRowLastStyle: React.CSSProperties = { ...statRowStyle, borderBottom: 'none' };
const labelStyle: React.CSSProperties = { color: 'var(--pf-t--global--text--color--subtle)' };
const valueStyle: React.CSSProperties = { fontFamily: 'var(--pf-t--global--font--family--mono)', fontWeight: 500 };
const hwValStyle: React.CSSProperties = {
    ...valueStyle, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.72rem',
};

interface SystemOverviewProps {
    stats: SystemStats;
    history: SystemHistory;
    hardware: HardwareInfo;
    perDiskHistory: Record<string, { read: HistoryPoint[]; write: HistoryPoint[] }>;
    perIfaceHistory: Record<string, { sent: HistoryPoint[]; recv: HistoryPoint[] }>;
    perCoreHistory: Record<number, HistoryPoint[]>;
    gpuStats: GpuStats[];
    gpuHistory: Record<number, { usage: HistoryPoint[]; memory: HistoryPoint[] }>;
}

export const SystemOverview: React.FC<SystemOverviewProps> = ({ stats, history, hardware, perDiskHistory, perIfaceHistory, perCoreHistory, gpuStats, gpuHistory }) => {
    const memPercent = stats.memoryTotal > 0 ? (stats.memoryUsed / stats.memoryTotal) * 100 : 0;
    const [selectedDisk, setSelectedDisk] = useState('');
    const [diskDropdownOpen, setDiskDropdownOpen] = useState(false);
    const [selectedIface, setSelectedIface] = useState('');
    const [ifaceDropdownOpen, setIfaceDropdownOpen] = useState(false);
    const [selectedCore, setSelectedCore] = useState<number | null>(null);
    const [coreDropdownOpen, setCoreDropdownOpen] = useState(false);
    const [selectedGpu, setSelectedGpu] = useState(0);
    const [gpuDropdownOpen, setGpuDropdownOpen] = useState(false);

    const diskDevices = hardware.diskDevices;
    const selectedDiskLabel = selectedDisk || _("All Disks");

    // Resolve disk graph data based on selection
    const diskReadHistory = selectedDisk && perDiskHistory[selectedDisk] ? perDiskHistory[selectedDisk].read : history.diskRead;
    const diskWriteHistory = selectedDisk && perDiskHistory[selectedDisk] ? perDiskHistory[selectedDisk].write : history.diskWrite;
    const diskReadRate = selectedDisk && stats.perDiskStats?.[selectedDisk] ? stats.perDiskStats[selectedDisk].readRate : stats.diskReadRate;
    const diskWriteRate = selectedDisk && stats.perDiskStats?.[selectedDisk] ? stats.perDiskStats[selectedDisk].writeRate : stats.diskWriteRate;

    // Resolve network graph data based on selection
    const netInterfaces = hardware.networkInterfaces;
    const selectedIfaceLabel = selectedIface || _("All Interfaces");
    const netRecvHistory = selectedIface && perIfaceHistory[selectedIface] ? perIfaceHistory[selectedIface].recv : history.networkRecv;
    const netSentHistory = selectedIface && perIfaceHistory[selectedIface] ? perIfaceHistory[selectedIface].sent : history.networkSent;
    const netRecvRate = selectedIface && stats.perIfaceStats?.[selectedIface] ? stats.perIfaceStats[selectedIface].recvRate : stats.networkRecvRate;
    const netSentRate = selectedIface && stats.perIfaceStats?.[selectedIface] ? stats.perIfaceStats[selectedIface].sentRate : stats.networkSentRate;

    // Resolve CPU graph data based on selection
    const selectedCoreLabel = selectedCore !== null ? cockpit.format(_("Core $0"), selectedCore) : _("All Cores");
    const cpuGraphData = selectedCore !== null && perCoreHistory[selectedCore] ? perCoreHistory[selectedCore] : history.cpu;
    const cpuCurrentValue = selectedCore !== null && stats.cpuPerCore[selectedCore] !== undefined
        ? `${stats.cpuPerCore[selectedCore].toFixed(1)}%`
        : `${stats.cpuUsage.toFixed(1)}%`;
    const cpuGraphLabel = selectedCore !== null
        ? cockpit.format(_("Core $0"), selectedCore)
        : cockpit.format(_("$0 Cores"), stats.cpuCores);

    return (
        <div style={{ marginBottom: 16 }}>
            <Grid hasGutter>
                {/* CPU */}
                <GridItem md={6} lg={3}>
                    <Card isCompact isFullHeight>
                        <CardTitle style={{ ...cardTitleStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{_("CPU")}</span>
                            {stats.cpuCores >= 1 && (
                                <Dropdown
                                    isOpen={coreDropdownOpen}
                                    onOpenChange={setCoreDropdownOpen}
                                    onSelect={(_e, val) => { setSelectedCore(val === '__all__' ? null : Number(val)); setCoreDropdownOpen(false); }}
                                    toggle={toggleRef => (
                                        <MenuToggle ref={toggleRef} onClick={() => setCoreDropdownOpen(!coreDropdownOpen)}
                                            isExpanded={coreDropdownOpen} variant="plainText"
                                            style={{ fontSize: '0.72rem', padding: '2px 8px' }}>
                                            {selectedCoreLabel}
                                        </MenuToggle>
                                    )}
                                >
                                    <DropdownList>
                                        <DropdownItem value="__all__" key="all">{_("All Cores")}</DropdownItem>
                                        {Array.from({ length: stats.cpuCores }, (_unused, i) => (
                                            <DropdownItem value={String(i)} key={i}>{cockpit.format(_("Core $0"), i)}</DropdownItem>
                                        ))}
                                    </DropdownList>
                                </Dropdown>
                            )}
                        </CardTitle>
                        <CardBody style={{ paddingTop: 0 }}>
                            <UsageGraph
                                data={cpuGraphData} color="#0066CC"
                                label={cpuGraphLabel}
                                currentValue={cpuCurrentValue}
                            />
                            <div style={{ marginTop: 8 }}>
                                {hardware.cpuModel && (
                                    <div style={statRowStyle}>
                                        <span style={labelStyle}>{_("Model")}</span>
                                        <span style={hwValStyle} title={hardware.cpuModel}>{hardware.cpuModel}</span>
                                    </div>
                                )}
                                {hardware.cpuFreqMHz && (
                                    <div style={statRowStyle}>
                                        <span style={labelStyle}>{_("Base Freq")}</span>
                                        <span style={valueStyle}>{hardware.cpuFreqMHz}</span>
                                    </div>
                                )}
                                <div style={statRowLastStyle}>
                                    <span style={labelStyle}>{_("Load Avg")}</span>
                                    <span style={valueStyle}>{stats.loadAvg.map(l => l.toFixed(2)).join(', ')}</span>
                                </div>
                            </div>
                            {stats.cpuPerCore.length > 0 && stats.cpuPerCore.length <= 32 && (
                                <div style={{ display: 'flex', gap: 2, height: 32, marginTop: 8, alignItems: 'flex-end', borderBottom: '1px solid var(--pf-t--global--border--color--default)', paddingBottom: 2 }}>
                                    {stats.cpuPerCore.map((usage, i) => (
                                        <div key={i} title={cockpit.format(_("Core $0: $1%"), i, usage.toFixed(1))}
                                            style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', background: 'var(--pf-t--global--background--color--primary--default)', borderRadius: '2px 2px 0 0', minWidth: 4, maxWidth: 20 }}>
                                            <div style={{
                                                width: '100%', borderRadius: '2px 2px 0 0', transition: 'height 0.3s ease', minHeight: 2,
                                                height: `${Math.max(2, usage)}%`,
                                                backgroundColor: usage > 80 ? '#C9190B' : usage > 50 ? '#F0AB00' : '#0066CC',
                                            }} />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardBody>
                    </Card>
                </GridItem>

                {/* Memory */}
                <GridItem md={6} lg={3}>
                    <Card isCompact isFullHeight>
                        <CardTitle style={cardTitleStyle}>{_("Memory")}</CardTitle>
                        <CardBody style={{ paddingTop: 0 }}>
                            <UsageGraph
                                data={history.memory} color="#009596"
                                label={formatBytes(stats.memoryTotal)}
                                currentValue={`${memPercent.toFixed(1)}%`}
                            />
                            <div style={{ marginTop: 8 }}>
                                <div style={statRowStyle}><span style={labelStyle}>{_("Used")}</span><span style={valueStyle}>{formatBytes(stats.memoryUsed)}</span></div>
                                <div style={statRowStyle}><span style={labelStyle}>{_("Cached")}</span><span style={valueStyle}>{formatBytes(stats.memoryCached)}</span></div>
                                <div style={statRowStyle}><span style={labelStyle}>{_("Free")}</span><span style={valueStyle}>{formatBytes(stats.memoryFree)}</span></div>
                                {stats.swapTotal > 0 && (
                                    <div style={statRowLastStyle}><span style={labelStyle}>{_("Swap")}</span><span style={valueStyle}>{formatBytes(stats.swapUsed)} / {formatBytes(stats.swapTotal)}</span></div>
                                )}
                            </div>
                        </CardBody>
                    </Card>
                </GridItem>

                {/* Disk - with per-disk selector */}
                <GridItem md={6} lg={3}>
                    <Card isCompact isFullHeight>
                        <CardTitle style={{ ...cardTitleStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{_("Disk")}</span>
                            {diskDevices.length >= 1 && (
                                <Dropdown
                                    isOpen={diskDropdownOpen}
                                    onOpenChange={setDiskDropdownOpen}
                                    onSelect={(_e, val) => { setSelectedDisk(val === '__all__' ? '' : String(val)); setDiskDropdownOpen(false); }}
                                    toggle={toggleRef => (
                                        <MenuToggle ref={toggleRef} onClick={() => setDiskDropdownOpen(!diskDropdownOpen)}
                                            isExpanded={diskDropdownOpen} variant="plainText"
                                            style={{ fontSize: '0.72rem', padding: '2px 8px' }}>
                                            {selectedDiskLabel}
                                        </MenuToggle>
                                    )}
                                >
                                    <DropdownList>
                                        <DropdownItem value="__all__" key="all">{_("All Disks")}</DropdownItem>
                                        {diskDevices.map(d => (
                                            <DropdownItem value={d.name} key={d.name}>{d.name} ({d.sizeGB})</DropdownItem>
                                        ))}
                                    </DropdownList>
                                </Dropdown>
                            )}
                        </CardTitle>
                        <CardBody style={{ paddingTop: 0 }}>
                            <UsageGraph
                                data={diskReadHistory} maxValue={0} color="#3E8635" fillColor="#3E8635"
                                label={_("Read")} currentValue={formatRate(diskReadRate)}
                                secondaryData={diskWriteHistory} secondaryColor="#F0AB00"
                                secondaryLabel={_("Write")} secondaryValue={formatRate(diskWriteRate)}
                            />
                            {diskDevices.length > 0 && (
                                <div style={{ marginTop: 8 }}>
                                    {diskDevices.map((d, i) => (
                                        <div key={d.name} style={i === diskDevices.length - 1 ? statRowLastStyle : statRowStyle}>
                                            <span style={labelStyle}>{d.name}</span>
                                            <span style={valueStyle}>{d.sizeGB}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardBody>
                    </Card>
                </GridItem>

                {/* Network - with per-interface selector */}
                <GridItem md={6} lg={3}>
                    <Card isCompact isFullHeight>
                        <CardTitle style={{ ...cardTitleStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{_("Network")}</span>
                            {netInterfaces.length >= 1 && (
                                <Dropdown
                                    isOpen={ifaceDropdownOpen}
                                    onOpenChange={setIfaceDropdownOpen}
                                    onSelect={(_e, val) => { setSelectedIface(val === '__all__' ? '' : String(val)); setIfaceDropdownOpen(false); }}
                                    toggle={toggleRef => (
                                        <MenuToggle ref={toggleRef} onClick={() => setIfaceDropdownOpen(!ifaceDropdownOpen)}
                                            isExpanded={ifaceDropdownOpen} variant="plainText"
                                            style={{ fontSize: '0.72rem', padding: '2px 8px' }}>
                                            {selectedIfaceLabel}
                                        </MenuToggle>
                                    )}
                                >
                                    <DropdownList>
                                        <DropdownItem value="__all__" key="all">{_("All Interfaces")}</DropdownItem>
                                        {netInterfaces.map(n => (
                                            <DropdownItem value={n.name} key={n.name}>{n.name}{n.speed ? ` (${n.speed})` : ''}</DropdownItem>
                                        ))}
                                    </DropdownList>
                                </Dropdown>
                            )}
                        </CardTitle>
                        <CardBody style={{ paddingTop: 0 }}>
                            <UsageGraph
                                data={netRecvHistory} maxValue={0} color="#8481DD" fillColor="#8481DD"
                                label={_("Receive")} currentValue={formatRate(netRecvRate)}
                                secondaryData={netSentHistory} secondaryColor="#EC7A08"
                                secondaryLabel={_("Send")} secondaryValue={formatRate(netSentRate)}
                            />
                            {hardware.networkInterfaces.length > 0 && (
                                <div style={{ marginTop: 8 }}>
                                    {hardware.networkInterfaces.map((n, i) => (
                                        <div key={n.name} style={i === hardware.networkInterfaces.length - 1 ? statRowLastStyle : statRowStyle}>
                                            <span style={labelStyle}>{n.name}</span>
                                            <span style={valueStyle}>{n.speed || _("Unknown")}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardBody>
                    </Card>
                </GridItem>

                {/* GPU - shown only when GPUs are detected */}
                {hardware.gpus.length > 0 && gpuStats.length > 0 && (() => {
                    const gpuIdx = Math.min(selectedGpu, gpuStats.length - 1);
                    const gpu = gpuStats[gpuIdx];
                    const gpuDev = hardware.gpus[gpuIdx];
                    const gpuHist = gpuHistory[gpuIdx] || { usage: [], memory: [] };
                    const formatMB = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
                    return (
                        <GridItem md={6} lg={3}>
                            <Card isCompact isFullHeight>
                                <CardTitle style={{ ...cardTitleStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>{_("GPU")}</span>
                                    {hardware.gpus.length >= 1 && (
                                        <Dropdown
                                            isOpen={gpuDropdownOpen}
                                            onOpenChange={setGpuDropdownOpen}
                                            onSelect={(_e, val) => { setSelectedGpu(Number(val)); setGpuDropdownOpen(false); }}
                                            toggle={toggleRef => (
                                                <MenuToggle ref={toggleRef} onClick={() => setGpuDropdownOpen(!gpuDropdownOpen)}
                                                    isExpanded={gpuDropdownOpen} variant="plainText"
                                                    style={{ fontSize: '0.72rem', padding: '2px 8px' }}>
                                                    {gpuDev?.name || cockpit.format(_("GPU $0"), gpuIdx)}
                                                </MenuToggle>
                                            )}
                                        >
                                            <DropdownList>
                                                {hardware.gpus.map((g, i) => (
                                                    <DropdownItem value={String(i)} key={i}>{g.name}</DropdownItem>
                                                ))}
                                            </DropdownList>
                                        </Dropdown>
                                    )}
                                </CardTitle>
                                <CardBody style={{ paddingTop: 0 }}>
                                    <UsageGraph
                                        data={gpuHist.usage} color="#A855F7"
                                        label={_("Utilization")}
                                        currentValue={`${gpu.gpuUsage.toFixed(0)}%`}
                                    />
                                    <div style={{ marginTop: 8 }}>
                                        <div style={statRowStyle}>
                                            <span style={labelStyle}>{_("VRAM")}</span>
                                            <span style={valueStyle}>{formatMB(gpu.memoryUsed)} / {formatMB(gpu.memoryTotal)}</span>
                                        </div>
                                        <div style={statRowStyle}>
                                            <span style={labelStyle}>{_("VRAM Usage")}</span>
                                            <span style={valueStyle}>{gpu.memoryUsage.toFixed(1)}%</span>
                                        </div>
                                        {gpu.temperature >= 0 && (
                                            <div style={statRowStyle}>
                                                <span style={labelStyle}>{_("Temperature")}</span>
                                                <span style={valueStyle}>{gpu.temperature.toFixed(0)} °C</span>
                                            </div>
                                        )}
                                        {gpu.powerDraw >= 0 && (
                                            <div style={statRowLastStyle}>
                                                <span style={labelStyle}>{_("Power")}</span>
                                                <span style={valueStyle}>{gpu.powerDraw.toFixed(1)} W</span>
                                            </div>
                                        )}
                                    </div>
                                    {/* VRAM usage mini-bar */}
                                    <div style={{ marginTop: 8, height: 10, background: 'var(--pf-t--global--background--color--secondary--default)', borderRadius: 4, overflow: 'hidden' }}>
                                        <div style={{
                                            width: `${Math.min(100, gpu.memoryUsage)}%`, height: '100%', borderRadius: 4,
                                            transition: 'width 0.3s ease',
                                            backgroundColor: gpu.memoryUsage > 80 ? '#C9190B' : gpu.memoryUsage > 50 ? '#F0AB00' : '#A855F7',
                                        }} />
                                    </div>
                                </CardBody>
                            </Card>
                        </GridItem>
                    );
                })()}
            </Grid>
        </div>
    );
};

export default SystemOverview;
