import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PosBackendApiService } from '../api/pos-backend-api.service';
import type { PosOfflineComprobanteSyncRequest } from '../api/pos-backend.types';

export type PosOfflineQueueStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR';

export interface PosOfflineComprobanteRecord {
  localId: string;
  offlineDeviceId: string;
  offlineSequence: string;
  offlineCreatedAt: string;
  status: PosOfflineQueueStatus;
  request: PosOfflineComprobanteSyncRequest;
  syncError?: string | null;
  remoteComprobanteId?: string | null;
  updatedAt: string;
}

const DB_NAME = 'pos-offline-sync';
const DB_VERSION = 1;
const STORE = 'comprobantes';
const K_DEVICE = 'pos.offline.deviceId';
const K_SEQUENCE = 'pos.offline.sequence';

@Injectable({ providedIn: 'root' })
export class PosOfflineSyncService {
  private readonly api = inject(PosBackendApiService);
  private dbPromise: Promise<IDBDatabase> | null = null;

  readonly pendingCount = signal(0);
  readonly records = signal<PosOfflineComprobanteRecord[]>([]);
  readonly syncing = signal(false);
  readonly lastMessage = signal('');

  deviceId(): string {
    const existing = localStorage.getItem(K_DEVICE)?.trim();
    if (existing) {
      return existing;
    }
    const id = `POS-${this.newId().slice(0, 8).toUpperCase()}`;
    localStorage.setItem(K_DEVICE, id);
    return id;
  }

  nextSequence(): string {
    const current = Number.parseInt(localStorage.getItem(K_SEQUENCE) ?? '0', 10);
    const next = Number.isFinite(current) ? current + 1 : 1;
    localStorage.setItem(K_SEQUENCE, String(next));
    return String(next).padStart(9, '0');
  }

  async enqueue(request: PosOfflineComprobanteSyncRequest): Promise<PosOfflineComprobanteRecord> {
    const record: PosOfflineComprobanteRecord = {
      localId: `${request.offlineDeviceId}-${request.offlineSequence}`,
      offlineDeviceId: request.offlineDeviceId,
      offlineSequence: request.offlineSequence,
      offlineCreatedAt: request.offlineCreatedAt,
      status: 'PENDING',
      request,
      syncError: null,
      remoteComprobanteId: null,
      updatedAt: new Date().toISOString(),
    };
    const db = await this.db();
    await this.put(db, record);
    await this.refreshPendingCount();
    this.lastMessage.set(`Comprobante guardado offline: ${request.offlineDeviceId}-${request.offlineSequence}`);
    return record;
  }

  async refreshPendingCount(): Promise<void> {
    const db = await this.db();
    const records = await this.all(db);
    this.records.set(this.sortRecords(records));
    this.pendingCount.set(records.filter((r) => r.status === 'PENDING' || r.status === 'ERROR').length);
  }

  async syncPending(): Promise<void> {
    if (this.syncing()) {
      return;
    }
    this.syncing.set(true);
    try {
      const db = await this.db();
      const records = (await this.all(db)).filter((r) => r.status === 'PENDING' || r.status === 'ERROR');
      if (!records.length) {
        this.lastMessage.set('No hay comprobantes offline pendientes.');
        return;
      }
      let synced = 0;
      for (const record of records) {
        await this.mark(db, record, 'SYNCING', null);
        try {
          const response = await firstValueFrom(this.api.postOfflineComprobanteSync(record.request));
          await this.mark(db, record, 'SYNCED', null, response.id);
          synced++;
        } catch (err) {
          const message = this.errorMessage(err);
          await this.mark(db, record, 'ERROR', message);
          if (err instanceof HttpErrorResponse && err.status === 0) {
            break;
          }
        }
      }
      this.lastMessage.set(synced ? `${synced} comprobante(s) sincronizado(s).` : 'No se pudo sincronizar la cola offline.');
      if (synced > 0) {
        try {
          await firstValueFrom(this.api.getOfflineSyncStatus(this.deviceId()));
        } catch {
          /* estado fiscal opcional */
        }
      }
    } finally {
      this.syncing.set(false);
      await this.refreshPendingCount();
    }
  }

  async loadRecords(): Promise<void> {
    await this.refreshPendingCount();
  }

  isConnectionError(err: unknown): boolean {
    return err instanceof HttpErrorResponse && err.status === 0;
  }

  private async mark(
    db: IDBDatabase,
    record: PosOfflineComprobanteRecord,
    status: PosOfflineQueueStatus,
    syncError: string | null,
    remoteComprobanteId: string | null = record.remoteComprobanteId ?? null,
  ): Promise<void> {
    await this.put(db, {
      ...record,
      status,
      syncError,
      remoteComprobanteId,
      updatedAt: new Date().toISOString(),
    });
  }

  private db(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'localId' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('offlineDeviceId', 'offlineDeviceId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  private put(db: IDBDatabase, record: PosOfflineComprobanteRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private all(db: IDBDatabase): Promise<PosOfflineComprobanteRecord[]> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as PosOfflineComprobanteRecord[]);
      req.onerror = () => reject(req.error);
    });
  }

  private sortRecords(records: PosOfflineComprobanteRecord[]): PosOfflineComprobanteRecord[] {
    return [...records].sort((a, b) => b.offlineCreatedAt.localeCompare(a.offlineCreatedAt));
  }

  private errorMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) {
        return 'Sin conexion con pos-app.';
      }
      const body = err.error;
      if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
        return body.message;
      }
      if (typeof body === 'string' && body.trim()) {
        return body.trim();
      }
      return `Error HTTP ${err.status}`;
    }
    return err instanceof Error ? err.message : 'Error de sincronizacion offline';
  }

  private newId(): string {
    return typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}
