import type { ComputedRef, ShallowRef } from "vue";
import {
  useBrokerConnection,
} from "./connection";
import type { CompletedExecution } from "@/worker/wasmrunner";
import type { ClosableTransport } from "@/transports";
import { useP2PConnection } from "./p2pConnection";
import type { WASMRun } from "@/fn/types";

// export const useConnection = useBrokerConnection;
export const useConnection = useP2PConnection;

export interface ConnectionStore {
  transport: ShallowRef<ClosableTransport | null>;
  connected: ComputedRef<boolean>;
  connect(url: string, certhash?: string): Promise<void>;
  run(body: WASMRun): Promise<CompletedExecution>;
}

// expected body type for file uploads
export type UploadedFile = {
  filename:   string,
  bytes:      Uint8Array,
  hash:       Uint8Array,
  length:     number,
  epoch:      BigInt,
}

// information about this provider to send to the broker
export type ProviderInfo = {
  name?: string;
  platform: string;
  useragent: string;
};

// updates about the pool capacity
export type PoolInfo = {
  nmax: number,
  pool: number,
}