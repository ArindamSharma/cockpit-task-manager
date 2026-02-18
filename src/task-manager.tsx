/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2017 Red Hat, Inc.
 */

import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { Alert, AlertActionCloseButton } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

import { RedoIcon } from "@patternfly/react-icons/dist/esm/icons/redo-icon.js";

import { SystemOverview } from './system-overview';
import { ProcessTable } from './process-table';
import { fetchProcesses } from './process-service';
import { fetchSystemStats, fetchHardwareInfo, getSystemHistory, getPerDiskHistory, getPerIfaceHistory, getPerCoreHistory, fetchGpuStats, getGpuHistory } from './system-stats-service';
import type { ProcessInfo, SystemStats, SystemHistory, HardwareInfo, HistoryPoint, GpuStats } from './types';

import cockpit from 'cockpit';

const _ = cockpit.gettext;

const UPDATE_INTERVAL = 2000;

export const TaskManager = () => {
    const [processes, setProcesses] = useState<ProcessInfo[]>([]);
    const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
    const [systemHistory, setSystemHistory] = useState<SystemHistory>({
        cpu: [], memory: [], diskRead: [], diskWrite: [], networkSent: [], networkRecv: [],
    });
    const [perDiskHistory, setPerDiskHistory] = useState<Record<string, { read: HistoryPoint[]; write: HistoryPoint[] }>>({});
    const [perIfaceHistory, setPerIfaceHistory] = useState<Record<string, { sent: HistoryPoint[]; recv: HistoryPoint[] }>>({});
    const [perCoreHistory, setPerCoreHistory] = useState<Record<number, HistoryPoint[]>>({});
    const [hardware, setHardware] = useState<HardwareInfo>({ cpuModel: '', cpuFreqMHz: '', diskDevices: [], networkInterfaces: [], gpus: [] });
    const [gpuStats, setGpuStats] = useState<GpuStats[]>([]);
    const [gpuHistory, setGpuHistory] = useState<Record<number, { usage: HistoryPoint[]; memory: HistoryPoint[] }>>({});
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [hostname, setHostname] = useState('');
    const [error, setError] = useState<string | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const refresh = useCallback(async () => {
        try {
            const [procs, stats] = await Promise.all([fetchProcesses(), fetchSystemStats()]);
            const gpuS = await fetchGpuStats(hardware.gpus);
            setProcesses(procs);
            setSystemStats(stats);
            setSystemHistory(getSystemHistory());
            setPerDiskHistory(getPerDiskHistory());
            setPerIfaceHistory(getPerIfaceHistory());
            setPerCoreHistory(getPerCoreHistory());
            setGpuStats(gpuS);
            setGpuHistory(getGpuHistory());
            setError(null);
        } catch (err: any) {
            setError(err.message || String(err));
        }
    }, [hardware.gpus]);

    useEffect(() => { fetchHardwareInfo().then(setHardware); }, []);

    useEffect(() => {
        refresh();
        if (autoRefresh) intervalRef.current = setInterval(refresh, UPDATE_INTERVAL);
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [autoRefresh, refresh]);

    useEffect(() => {
        const hostname = cockpit.file('/etc/hostname');
        hostname.watch(content => setHostname(content?.trim() ?? ""));
        return hostname.close;
    }, []);

    return (
        <Page style={{ display: 'block' }}>
            {/* Header - matches Cockpit Overview page style */}
            <PageSection style={{ flexShrink: 0, paddingInline: 'var(--pf-v6-c-page__main-section--PaddingTop, 24px)' }}>
                <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
                    <FlexItem>
                        <Content>
                            <Content component="h2">{_("Task Manager")}</Content>
                        </Content>
                    </FlexItem>
                    <FlexItem>
                        <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsMd' }}>
                            {hostname && (
                                <FlexItem>
                                    <span style={{ color: 'var(--pf-t--global--text--color--subtle)', fontSize: '0.85rem' }}>{hostname}</span>
                                </FlexItem>
                            )}
                            <FlexItem>
                                <Switch id="auto-refresh" label={_("Auto refresh")} isChecked={autoRefresh}
                                    onChange={(_e, c) => setAutoRefresh(c)} isReversed />
                            </FlexItem>
                            <FlexItem>
                                <Button variant="secondary" icon={<RedoIcon />} onClick={refresh} size="sm">{_("Refresh")}</Button>
                            </FlexItem>
                        </Flex>
                    </FlexItem>
                </Flex>
            </PageSection>

            {error && (
                <PageSection padding={{ default: 'noPadding' }}>
                    <Alert variant="danger" title={error} actionClose={<AlertActionCloseButton onClose={() => setError(null)} />} />
                </PageSection>
            )}

            {/* Main content - no separator between overview and process table */}
            <PageSection isFilled style={{ paddingInline: 'var(--pf-v6-c-page__main-section--PaddingTop, 24px)' }}>
                {systemStats && (
                    <SystemOverview stats={systemStats} history={systemHistory} hardware={hardware}
                        perDiskHistory={perDiskHistory} perIfaceHistory={perIfaceHistory} perCoreHistory={perCoreHistory}
                        gpuStats={gpuStats} gpuHistory={gpuHistory} />
                )}
                <ProcessTable processes={processes} onRefresh={refresh} />
            </PageSection>

            {/* Status bar */}
            <PageSection padding={{ default: 'noPadding' }}
                style={{ padding: '4px 16px', borderTop: '1px solid var(--pf-t--global--border--color--default)', fontSize: '0.75rem' }}>
                <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }}>
                    <FlexItem>
                        <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
                            {cockpit.format(_("$0 processes"), processes.length)}
                            {' | '}
                            {cockpit.format(_("Update interval: $0s"), UPDATE_INTERVAL / 1000)}
                        </span>
                    </FlexItem>
                    <FlexItem>
                        <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
                            {autoRefresh ? _("Auto-refreshing") : _("Paused")}
                        </span>
                    </FlexItem>
                </Flex>
            </PageSection>
        </Page>
    );
};
