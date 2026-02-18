/*
 * ProcessTable - Sortable, searchable process list with actions (inline styles only)
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { SearchInput } from "@patternfly/react-core/dist/esm/components/SearchInput/index.js";
import { Toolbar, ToolbarContent, ToolbarItem, ToolbarGroup } from "@patternfly/react-core/dist/esm/components/Toolbar/index.js";
import { Modal, ModalBody, ModalHeader, ModalFooter } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Card, CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Dropdown, DropdownItem, DropdownList } from "@patternfly/react-core/dist/esm/components/Dropdown/index.js";
import { MenuToggle } from "@patternfly/react-core/dist/esm/components/MenuToggle/index.js";

import { SortAmountDownIcon } from "@patternfly/react-icons/dist/esm/icons/sort-amount-down-icon.js";
import { SortAmountUpIcon } from "@patternfly/react-icons/dist/esm/icons/sort-amount-up-icon.js";
import { TimesIcon } from "@patternfly/react-icons/dist/esm/icons/times-icon.js";
import { PauseIcon } from "@patternfly/react-icons/dist/esm/icons/pause-icon.js";
import { PlayIcon } from "@patternfly/react-icons/dist/esm/icons/play-icon.js";
import { SearchIcon } from "@patternfly/react-icons/dist/esm/icons/search-icon.js";

import { killProcess } from './process-service';
import { formatBytes } from './system-stats-service';
import type { ProcessInfo, SortField, SortConfig } from './types';

import cockpit from 'cockpit';

const _ = cockpit.gettext;

type SearchMode = 'name' | 'pid';

const STATE_LABELS: Record<string, { text: string; color: 'blue' | 'green' | 'orange' | 'red' | 'grey' | 'teal' | 'purple' }> = {
    S: { text: 'Sleeping', color: 'blue' },
    R: { text: 'Running', color: 'green' },
    D: { text: 'Disk Wait', color: 'orange' },
    Z: { text: 'Zombie', color: 'red' },
    T: { text: 'Stopped', color: 'grey' },
    t: { text: 'Traced', color: 'grey' },
    I: { text: 'Idle', color: 'teal' },
    X: { text: 'Dead', color: 'red' },
};

const COLUMNS: { field: SortField; label: string; sortable: boolean; align?: 'right'; width?: string }[] = [
    { field: 'pid', label: 'PID', sortable: true, align: 'right', width: '6%' },
    { field: 'name', label: 'Name', sortable: true, width: '16%' },
    { field: 'user', label: 'User', sortable: true, width: '8%' },
    { field: 'state', label: 'Status', sortable: true, width: '8%' },
    { field: 'cpu', label: 'CPU %', sortable: true, align: 'right', width: '10%' },
    { field: 'memory', label: 'Memory %', sortable: true, align: 'right', width: '10%' },
    { field: 'memoryRss', label: 'Memory', sortable: true, align: 'right', width: '8%' },
    { field: 'diskRead', label: 'Disk R', sortable: true, align: 'right', width: '9%' },
    { field: 'diskWrite', label: 'Disk W', sortable: true, align: 'right', width: '9%' },
    { field: 'threads', label: 'Threads', sortable: true, align: 'right', width: '6%' },
];

/* Shared inline styles */
const mono: React.CSSProperties = { fontFamily: 'var(--pf-t--global--font--family--mono)', fontSize: '0.78rem' };
const thBase: React.CSSProperties = { padding: '6px 8px', whiteSpace: 'nowrap', userSelect: 'none' };
const tdBase: React.CSSProperties = { padding: '4px 8px', whiteSpace: 'nowrap', verticalAlign: 'middle', overflow: 'hidden', textOverflow: 'ellipsis' };
const right: React.CSSProperties = { textAlign: 'right' };
const miniBarOuter: React.CSSProperties = {
    width: 50, height: 10, background: 'var(--pf-t--global--background--color--secondary--default)',
    borderRadius: 2, overflow: 'hidden', flexShrink: 0,
};

interface ProcessTableProps {
    processes: ProcessInfo[];
    onRefresh: () => void;
}

export const ProcessTable: React.FC<ProcessTableProps> = ({ processes, onRefresh }) => {
    const [sort, setSort] = useState<SortConfig>({ field: 'cpu', direction: 'desc' });
    const [searchQuery, setSearchQuery] = useState('');
    const [searchMode, setSearchMode] = useState<SearchMode>('name');
    const [perPage, setPerPage] = useState(50);
    const [pageSizeDropdownOpen, setPageSizeDropdownOpen] = useState(false);
    const [selectedPid, setSelectedPid] = useState<number | null>(null);
    const [killModalOpen, setKillModalOpen] = useState(false);
    const [killSignal, setKillSignal] = useState('TERM');
    const [actionError, setActionError] = useState<string | null>(null);
    const [signalDropdownOpen, setSignalDropdownOpen] = useState(false);

    const filteredProcesses = useMemo(() => {
        if (!searchQuery.trim()) return processes;
        const query = searchQuery.trim();
        return processes.filter(proc => {
            switch (searchMode) {
                case 'pid': return String(proc.pid).includes(query);
                default: return proc.name.toLowerCase().includes(query.toLowerCase()) || proc.cmdline.toLowerCase().includes(query.toLowerCase());
            }
        });
    }, [processes, searchQuery, searchMode]);

    const sortedProcesses = useMemo(() => {
        const sorted = [...filteredProcesses];
        sorted.sort((a, b) => {
            let aVal: any = a[sort.field], bVal: any = b[sort.field];
            if (typeof aVal === 'string') { aVal = aVal.toLowerCase(); bVal = (bVal as string).toLowerCase(); }
            if (aVal < bVal) return sort.direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return sort.direction === 'asc' ? 1 : -1;
            return 0;
        });
        return sorted;
    }, [filteredProcesses, sort]);

    const visibleProcesses = useMemo(() => {
        return sortedProcesses.slice(0, perPage);
    }, [sortedProcesses, perPage]);

    const PAGE_SIZE_OPTIONS = [10, 25, 50, 75, 100];

    const handleSort = useCallback((field: SortField) => {
        setSort(prev => ({ field, direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc' }));
    }, []);

    const handleKill = useCallback(async () => {
        if (selectedPid === null) return;
        setActionError(null);
        const result = await killProcess(selectedPid, killSignal);
        if (result.success) { setKillModalOpen(false); setSelectedPid(null); setTimeout(onRefresh, 500); }
        else setActionError(result.error || _("Failed to send signal"));
    }, [selectedPid, killSignal, onRefresh]);

    const handleStopProcess = useCallback(async (pid: number) => {
        const result = await killProcess(pid, 'STOP');
        if (!result.success) setActionError(result.error || _("Failed to stop process"));
        setTimeout(onRefresh, 500);
    }, [onRefresh]);

    const handleContinueProcess = useCallback(async (pid: number) => {
        const result = await killProcess(pid, 'CONT');
        if (!result.success) setActionError(result.error || _("Failed to continue process"));
        setTimeout(onRefresh, 500);
    }, [onRefresh]);

    const getStateLabel = (state: string) => {
        const first = state.charAt(0);
        const info = STATE_LABELS[first] || { text: state, color: 'grey' as const };
        return <Label color={info.color} isCompact>{info.text}</Label>;
    };

    const cpuColor = (v: number) => v > 80 ? '#C9190B' : v > 50 ? '#F0AB00' : '#0066CC';
    const memColor = (v: number) => v > 80 ? '#C9190B' : v > 50 ? '#F0AB00' : '#009596';

    const selectedProcess = processes.find(p => p.pid === selectedPid);

    return (
        <Card>
            <CardBody style={{ padding: 0 }}>
                {/* Toolbar */}
                <Toolbar style={{ padding: '8px 16px', borderBottom: '1px solid var(--pf-t--global--border--color--default)' }}>
                    <ToolbarContent>
                        <ToolbarGroup>
                            <ToolbarItem style={{ minWidth: 250 }}>
                                <SearchInput
                                    placeholder={searchMode === 'pid' ? _("Search by PID...") : _("Search processes...")}
                                    value={searchQuery}
                                    onChange={(_e, v) => { setSearchQuery(v); }}
                                    onClear={() => { setSearchQuery(''); }}
                                />
                            </ToolbarItem>
                            <ToolbarItem>
                                <Button variant={searchMode === 'name' ? 'primary' : 'secondary'} size="sm"
                                    onClick={() => setSearchMode('name')}>{_("Name")}</Button>
                                {' '}
                                <Button variant={searchMode === 'pid' ? 'primary' : 'secondary'} size="sm"
                                    onClick={() => setSearchMode('pid')}>PID</Button>
                            </ToolbarItem>
                        </ToolbarGroup>
                        <ToolbarGroup align={{ default: 'alignEnd' }}>
                            <ToolbarItem>
                                <Dropdown
                                    isOpen={pageSizeDropdownOpen}
                                    onOpenChange={setPageSizeDropdownOpen}
                                    onSelect={(_e, val) => {
                                        const num = Number(val);
                                        if (num > 0) { setPerPage(num); }
                                        setPageSizeDropdownOpen(false);
                                    }}
                                    toggle={toggleRef => (
                                        <MenuToggle ref={toggleRef} onClick={() => setPageSizeDropdownOpen(!pageSizeDropdownOpen)}
                                            isExpanded={pageSizeDropdownOpen} variant="plainText"
                                            style={{ fontSize: '0.8rem', padding: '2px 8px' }}>
                                            {cockpit.format(_("Show $0"), perPage)}
                                        </MenuToggle>
                                    )}
                                >
                                    <DropdownList>
                                        {PAGE_SIZE_OPTIONS.map(n => (
                                            <DropdownItem value={String(n)} key={n}>{String(n)}</DropdownItem>
                                        ))}
                                    </DropdownList>
                                </Dropdown>
                            </ToolbarItem>
                            <ToolbarItem>
                                <span style={{ fontSize: '0.85rem', color: 'var(--pf-t--global--text--color--subtle)', fontFamily: 'var(--pf-t--global--font--family--mono)' }}>
                                    {cockpit.format(_("$0 of $1"), visibleProcesses.length, filteredProcesses.length)}
                                    {searchQuery && cockpit.format(_(" (total $0)"), processes.length)}
                                </span>
                            </ToolbarItem>
                        </ToolbarGroup>
                    </ToolbarContent>
                </Toolbar>

                {actionError && (
                    <Alert variant="danger" isInline title={actionError} style={{ margin: '8px 16px 0' }}
                        actionClose={<Button variant="plain" onClick={() => setActionError(null)}><TimesIcon /></Button>}
                    />
                )}

                {/* Table */}
                <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '55vh' }}>
                    <table className="pf-v6-c-table pf-m-compact pf-m-grid-md" role="grid" style={{ width: '100%', fontSize: '0.82rem', tableLayout: 'fixed' }}>
                        <thead className="pf-v6-c-table__thead" style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--pf-t--global--background--color--secondary--default)' }}>
                            <tr className="pf-v6-c-table__tr">
                                {COLUMNS.map(col => (
                                    <th key={col.field} className="pf-v6-c-table__th"
                                        style={{ ...thBase, ...(col.align === 'right' ? right : {}), cursor: col.sortable ? 'pointer' : 'default', width: col.width, overflow: 'hidden', textOverflow: 'ellipsis' }}
                                        onClick={() => col.sortable && handleSort(col.field)} role="columnheader">
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                            {_(col.label)}
                                            {sort.field === col.field && (
                                                <span style={{ fontSize: '0.7rem', color: 'var(--pf-t--global--icon--color--brand--default)' }}>
                                                    {sort.direction === 'desc' ? <SortAmountDownIcon /> : <SortAmountUpIcon />}
                                                </span>
                                            )}
                                        </span>
                                    </th>
                                ))}
                                <th className="pf-v6-c-table__th" style={{ ...thBase, textAlign: 'center', width: '10%' }}>{_("Actions")}</th>
                            </tr>
                        </thead>
                        <tbody className="pf-v6-c-table__tbody">
                            {visibleProcesses.map(proc => (
                                <tr key={proc.pid} className="pf-v6-c-table__tr"
                                    style={{ cursor: 'pointer', ...(selectedPid === proc.pid ? { background: 'var(--pf-t--global--background--color--primary--clicked)' } : {}) }}
                                    onClick={() => setSelectedPid(proc.pid === selectedPid ? null : proc.pid)}>

                                    <td className="pf-v6-c-table__td" style={{ ...tdBase, ...right, ...mono }}>{proc.pid}</td>
                                    <td className="pf-v6-c-table__td" style={tdBase}>
                                        <Tooltip content={proc.cmdline || proc.name} position="top">
                                            <span style={{ display: 'inline-block', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, verticalAlign: 'middle' }}>
                                                {proc.name}
                                            </span>
                                        </Tooltip>
                                    </td>
                                    <td className="pf-v6-c-table__td" style={tdBase}>{proc.user}</td>
                                    <td className="pf-v6-c-table__td" style={tdBase}>{getStateLabel(proc.state)}</td>
                                    <td className="pf-v6-c-table__td" style={{ ...tdBase, ...right }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                                            <div style={miniBarOuter}>
                                                <div style={{ width: `${Math.min(100, proc.cpu)}%`, height: '100%', borderRadius: 2, transition: 'width 0.3s ease', backgroundColor: cpuColor(proc.cpu) }} />
                                            </div>
                                            <span style={mono}>{proc.cpu.toFixed(1)}</span>
                                        </div>
                                    </td>
                                    <td className="pf-v6-c-table__td" style={{ ...tdBase, ...right }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                                            <div style={miniBarOuter}>
                                                <div style={{ width: `${Math.min(100, proc.memory)}%`, height: '100%', borderRadius: 2, transition: 'width 0.3s ease', backgroundColor: memColor(proc.memory) }} />
                                            </div>
                                            <span style={mono}>{proc.memory.toFixed(1)}</span>
                                        </div>
                                    </td>
                                    <td className="pf-v6-c-table__td" style={{ ...tdBase, ...right, ...mono }}>{formatBytes(proc.memoryRss, 0)}</td>
                                    <td className="pf-v6-c-table__td" style={{ ...tdBase, ...right, ...mono }}>{proc.diskRead > 0 ? `${proc.diskRead.toFixed(1)} KB/s` : '-'}</td>
                                    <td className="pf-v6-c-table__td" style={{ ...tdBase, ...right, ...mono }}>{proc.diskWrite > 0 ? `${proc.diskWrite.toFixed(1)} KB/s` : '-'}</td>
                                    <td className="pf-v6-c-table__td" style={{ ...tdBase, ...right, ...mono }}>{proc.threads}</td>
                                    <td className="pf-v6-c-table__td" style={{ ...tdBase, textAlign: 'center' }}>
                                        <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                                            <Tooltip content={_("End task")} position="top">
                                                <Button variant="danger" size="sm"
                                                    style={{ padding: '2px 8px', lineHeight: 1, minWidth: 0 }}
                                                    onClick={() => { setSelectedPid(proc.pid); setKillModalOpen(true); }}
                                                    aria-label={cockpit.format(_("End process $0"), proc.pid)}
                                                    icon={<TimesIcon />} />
                                            </Tooltip>
                                            {proc.state.startsWith('T') ? (
                                                <Tooltip content={_("Resume process")} position="top">
                                                    <Button variant="secondary" size="sm"
                                                        style={{ padding: '2px 8px', lineHeight: 1, minWidth: 0 }}
                                                        onClick={() => handleContinueProcess(proc.pid)}
                                                        aria-label={cockpit.format(_("Resume process $0"), proc.pid)}
                                                        icon={<PlayIcon />} />
                                                </Tooltip>
                                            ) : (
                                                <Tooltip content={_("Pause process")} position="top">
                                                    <Button variant="secondary" size="sm"
                                                        style={{ padding: '2px 8px', lineHeight: 1, minWidth: 0 }}
                                                        onClick={() => handleStopProcess(proc.pid)}
                                                        aria-label={cockpit.format(_("Pause process $0"), proc.pid)}
                                                        icon={<PauseIcon />} />
                                                </Tooltip>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {visibleProcesses.length === 0 && (
                                <tr className="pf-v6-c-table__tr">
                                    <td className="pf-v6-c-table__td" colSpan={COLUMNS.length + 1}>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--pf-t--global--text--color--subtle)', gap: 8, fontSize: '0.9rem' }}>
                                            <SearchIcon style={{ fontSize: '2rem' }} />
                                            <span>{searchQuery ? _("No processes match your search") : _("No processes found")}</span>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Kill modal */}
                <Modal isOpen={killModalOpen} onClose={() => setKillModalOpen(false)} aria-labelledby="kill-modal-title" variant="small">
                    <ModalHeader title={_("End Process")} labelId="kill-modal-title" />
                    <ModalBody>
                        {selectedProcess && (
                            <div>
                                <p style={{ marginBottom: 16 }}>
                                    {cockpit.format(_("Are you sure you want to send signal to process $0 (PID: $1)?"), selectedProcess.name, selectedProcess.pid)}
                                </p>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <span style={{ fontWeight: 600 }}>{_("Signal")}:</span>
                                    <Dropdown
                                        isOpen={signalDropdownOpen}
                                        onOpenChange={setSignalDropdownOpen}
                                        onSelect={(_e, val) => { setKillSignal(String(val)); setSignalDropdownOpen(false); }}
                                        toggle={toggleRef => (
                                            <MenuToggle ref={toggleRef} onClick={() => setSignalDropdownOpen(!signalDropdownOpen)} isExpanded={signalDropdownOpen}>
                                                {killSignal}
                                            </MenuToggle>
                                        )}
                                    >
                                        <DropdownList>
                                            <DropdownItem value="TERM" key="TERM" description={_("Graceful termination")}>SIGTERM</DropdownItem>
                                            <DropdownItem value="KILL" key="KILL" description={_("Force kill (cannot be caught)")}>SIGKILL</DropdownItem>
                                            <DropdownItem value="HUP" key="HUP" description={_("Hangup / reload config")}>SIGHUP</DropdownItem>
                                            <DropdownItem value="INT" key="INT" description={_("Interrupt (like Ctrl+C)")}>SIGINT</DropdownItem>
                                            <DropdownItem value="QUIT" key="QUIT" description={_("Quit with core dump")}>SIGQUIT</DropdownItem>
                                        </DropdownList>
                                    </Dropdown>
                                </div>
                            </div>
                        )}
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="danger" onClick={handleKill}>{_("Send Signal")}</Button>
                        <Button variant="link" onClick={() => setKillModalOpen(false)}>{_("Cancel")}</Button>
                    </ModalFooter>
                </Modal>
            </CardBody>
        </Card>
    );
};

export default ProcessTable;
