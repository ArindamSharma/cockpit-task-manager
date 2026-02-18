/*
 * UsageGraph - SVG-based real-time usage graph (inline styles only)
 */

import React from 'react';
import type { HistoryPoint } from './types';

interface UsageGraphProps {
    data: HistoryPoint[];
    maxValue?: number;
    height?: number;
    color: string;
    fillColor?: string;
    label: string;
    currentValue: string;
    secondaryData?: HistoryPoint[];
    secondaryColor?: string;
    secondaryLabel?: string;
    secondaryValue?: string;
}

export const UsageGraph: React.FC<UsageGraphProps> = ({
    data, maxValue = 100, height = 120, color, fillColor, label, currentValue,
    secondaryData, secondaryColor, secondaryLabel, secondaryValue,
}) => {
    const width = 280;
    const padding = { top: 5, right: 5, bottom: 5, left: 5 };
    const graphWidth = width - padding.left - padding.right;
    const graphHeight = height - padding.top - padding.bottom;

    const buildPath = (points: HistoryPoint[], maxVal: number, fill: boolean): string => {
        if (points.length === 0) return '';
        const effectiveMax = maxVal > 0 ? maxVal : 1;
        const step = graphWidth / 59;
        const coords = points.map((p, i) => ({
            x: padding.left + (59 - (points.length - 1 - i)) * step,
            y: padding.top + graphHeight - (Math.min(p.value, effectiveMax) / effectiveMax) * graphHeight,
        }));
        let d = `M ${coords[0].x} ${coords[0].y}`;
        for (let i = 1; i < coords.length; i++) d += ` L ${coords[i].x} ${coords[i].y}`;
        if (fill && coords.length > 0) {
            d += ` L ${coords[coords.length - 1].x} ${padding.top + graphHeight}`;
            d += ` L ${coords[0].x} ${padding.top + graphHeight} Z`;
        }
        return d;
    };

    const actualMax = maxValue === 0
        ? Math.max(...data.map(d => d.value), ...(secondaryData?.map(d => d.value) ?? []), 1)
        : maxValue;

    const hasDualSeries = !!(secondaryData && secondaryLabel);

    return (
        <div style={{ marginBottom: 8 }}>
            {!hasDualSeries && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, fontSize: '0.8rem' }}>
                    <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>{label}</span>
                    <span style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--pf-t--global--font--family--mono)', color }}>{currentValue}</span>
                </div>
            )}
            {hasDualSeries && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, fontSize: '0.8rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--pf-t--global--text--color--subtle)' }}>
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: fillColor || color }} />
                        {label}
                    </span>
                    <span style={{ fontWeight: 600, fontFamily: 'var(--pf-t--global--font--family--mono)', color }}>{currentValue}</span>
                </div>
            )}
            <svg
                width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
                style={{ border: '1px solid var(--pf-t--global--border--color--default)', borderRadius: 4, background: 'var(--pf-t--global--background--color--primary--default)' }}
            >
                {[0.25, 0.5, 0.75].map(frac => (
                    <line key={frac}
                        x1={padding.left} y1={padding.top + graphHeight * (1 - frac)}
                        x2={padding.left + graphWidth} y2={padding.top + graphHeight * (1 - frac)}
                        stroke="var(--pf-t--global--border--color--default)" strokeWidth="0.5" strokeDasharray="2,4" opacity="0.4"
                    />
                ))}
                <line x1={padding.left} y1={padding.top + graphHeight} x2={padding.left + graphWidth} y2={padding.top + graphHeight}
                    stroke="var(--pf-t--global--border--color--default)" strokeWidth="1" opacity="0.5" />
                {secondaryData && secondaryData.length > 0 && <>
                    <path d={buildPath(secondaryData, actualMax, true)} fill={secondaryColor || '#8B8D8F'} opacity="0.15" />
                    <path d={buildPath(secondaryData, actualMax, false)} fill="none" stroke={secondaryColor || '#8B8D8F'} strokeWidth="1.5" />
                </>}
                {data.length > 0 && <path d={buildPath(data, actualMax, true)} fill={fillColor || color} opacity="0.2" />}
                {data.length > 0 && <path d={buildPath(data, actualMax, false)} fill="none" stroke={color} strokeWidth="2" />}
            </svg>
            {hasDualSeries && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, fontSize: '0.8rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--pf-t--global--text--color--subtle)' }}>
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: secondaryColor }} />
                        {secondaryLabel}
                    </span>
                    <span style={{ fontWeight: 600, fontFamily: 'var(--pf-t--global--font--family--mono)', color: secondaryColor }}>{secondaryValue}</span>
                </div>
            )}
        </div>
    );
};

export default UsageGraph;
