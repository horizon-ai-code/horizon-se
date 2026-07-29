"use client";

import { useState, useEffect } from "react";
import type { SystemMetricsPayload } from "@/types/websocket";

export interface SystemMonitorState {
  systemMetrics: SystemMetricsPayload | null;
  samples: SystemMetricsPayload[];
  connected: boolean;
}

export function useSystemMonitor(): SystemMonitorState {
  const [systemMetrics, setSystemMetrics] = useState<SystemMetricsPayload | null>(null);
  const [samples, setSamples] = useState<SystemMetricsPayload[]>([]);

  useEffect(() => {
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 1;
      const cpu = Math.floor(10 + Math.random() * 25);
      const memPercent = Math.floor(45 + Math.random() * 5);
      const gpuUtil = Math.floor(30 + Math.random() * 20);
      const gpuMemPercent = Math.floor(55 + Math.random() * 5);
      
      const payload: SystemMetricsPayload = {
        gpu_utilization: gpuUtil,
        gpu_memory_percent: gpuMemPercent,
        gpu_memory_used_gb: parseFloat((24 * (gpuMemPercent / 100)).toFixed(2)),
        gpu_memory_total_gb: 24,
        has_gpu: true,
        cpu_percent: cpu,
        memory_percent: memPercent,
        memory_used_gb: parseFloat((32 * (memPercent / 100)).toFixed(2)),
        memory_total_gb: 32,
        elapsed_seconds: elapsed,
        pid: 8080
      };
      
      setSystemMetrics(payload);
      setSamples((prev) => {
        const next = [...prev, payload];
        return next.length > 60 ? next.slice(-60) : next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return { systemMetrics, samples, connected: true };
}
