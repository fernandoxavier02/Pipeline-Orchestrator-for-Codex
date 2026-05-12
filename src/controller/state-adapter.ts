import type { SentinelState } from "../sentinel/sentinel-state.js";

/**
 * State Adapter — módulo dedicado de persistência para o pipeline.
 *
 * Responsabilidade única: salvar e carregar estado do pipeline.
 * NÃO toma decisões de orquestração (fases, gates, workflow switch).
 */

export type PersistedGateLogEntry = {
  gate: string;
  hardness: string;
  phase: string;
  decision: string;
  decided_by: string;
  timestamp: string;
  detail: string;
  confidence_impact: number;
  execution_identity?: Record<string, unknown>;
};

export interface SessionStore {
  root?: string;
  load: () => Promise<unknown>;
  save?: (session: unknown) => Promise<void>;
}

export interface CheckpointStore {
  root?: string;
  list: () => Promise<Array<{ name: string; status: string }>>;
  save?: (checkpoint: unknown) => Promise<void>;
}

export interface GateLogStore {
  root?: string;
  append: (decision: unknown) => Promise<void>;
  list?: () => Promise<PersistedGateLogEntry[]>;
}

export interface ConfidenceStore {
  root?: string;
  save: (snapshot: unknown) => Promise<void>;
  load?: () => Promise<unknown>;
}

export interface SentinelStore {
  root?: string;
  save: (state: unknown) => Promise<void>;
  load?: () => Promise<SentinelState>;
}

export interface StateAdapterDeps {
  session: SessionStore;
  checkpoints: CheckpointStore;
  gateLog: GateLogStore;
  confidence: ConfidenceStore;
  sentinel: SentinelStore;
}

export interface StateAdapter {
  /** Carrega a sessão atual do pipeline. Retorna undefined se não existir. */
  loadSession(): Promise<unknown | undefined>;

  /** Persiste o estado da sessão. */
  saveSession(session: unknown): Promise<void>;

  /** Lista todos os checkpoints salvos. */
  listCheckpoints(): Promise<Array<{ name: string; status: string }>>;

  /** Salva um novo checkpoint. */
  saveCheckpoint(checkpoint: unknown): Promise<void>;

  /** Apenda uma decisão de gate no log (JSONL). */
  appendGateDecision(decision: unknown): Promise<void>;

  /** Lista todas as decisões de gate persistidas. */
  listGateDecisions(): Promise<PersistedGateLogEntry[]>;

  /** Carrega o confidence score atual. */
  loadConfidence(): Promise<unknown | undefined>;

  /** Salva o confidence score. */
  saveConfidence(snapshot: unknown): Promise<void>;

  /** Carrega o estado do sentinel. */
  loadSentinel(): Promise<SentinelState | undefined>;

  /** Salva o estado do sentinel. */
  saveSentinel(state: unknown): Promise<void>;
}

/**
 * Factory que cria um StateAdapter a partir das dependências de store.
 *
 * O adapter é um thin wrapper que simplifica o acesso aos stores,
 * garantindo defaults seguros quando métodos opcionais não estão presentes.
 */
export function createStateAdapter(deps: StateAdapterDeps): StateAdapter {
  return {
    async loadSession() {
      return deps.session.load();
    },

    async saveSession(session) {
      if (deps.session.save) {
        await deps.session.save(session);
      }
    },

    async listCheckpoints() {
      return deps.checkpoints.list();
    },

    async saveCheckpoint(checkpoint) {
      if (deps.checkpoints.save) {
        await deps.checkpoints.save(checkpoint);
      }
    },

    async appendGateDecision(decision) {
      await deps.gateLog.append(decision);
    },

    async listGateDecisions() {
      if (deps.gateLog.list) {
        return deps.gateLog.list();
      }
      return [];
    },

    async loadConfidence() {
      if (deps.confidence.load) {
        return deps.confidence.load();
      }
      return undefined;
    },

    async saveConfidence(snapshot) {
      await deps.confidence.save(snapshot);
    },

    async loadSentinel() {
      if (deps.sentinel.load) {
        return deps.sentinel.load();
      }
      return undefined;
    },

    async saveSentinel(state) {
      if (deps.sentinel.save) {
        await deps.sentinel.save(state);
      }
    },
  };
}
