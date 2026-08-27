import React from "react";
import { useLocation } from "wouter";

/** Legacy stub — collection runs as Jobs, not a separate worker fleet. */
export default function Collectors() {
  const [, setLocation] = useLocation();
  React.useEffect(() => {
    setLocation("/jobs");
  }, [setLocation]);
  return null;
}
