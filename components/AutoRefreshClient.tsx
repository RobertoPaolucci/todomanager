"use client";

import { useEffect } from "react";

type Props = {
  intervalMs?: number;
};

export default function AutoRefreshClient({
  intervalMs = 60000,
}: Props) {
  useEffect(() => {
    const timer = window.setInterval(() => {
      window.location.reload();
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return null;
}