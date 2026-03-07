// Quick script to reset the circuit breaker
import { openClawAdapter } from "./adapter";

// Access the private circuit field to reset it
const adapter = openClawAdapter as any;
if (adapter.circuit) {
  adapter.circuit.failures = 0;
  adapter.circuit.openedAt = null;
  console.log("✅ Circuit breaker reset");
} else {
  console.log("❌ Circuit breaker not found");
}