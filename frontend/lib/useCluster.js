"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../app/api";

// Loads one cluster and its articles on demand. Lives outside ClusterPanel so
// the desktop panel and the mobile sheet share a single request.
export default function useCluster(clusterId) {
  const [cluster, setCluster] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!clusterId) {
      setCluster(null);
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    apiGet(`/clusters/${clusterId}`)
      .then((data) => {
        if (!cancelled) setCluster(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setCluster(null);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clusterId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { cluster, error, loading, retry };
}
