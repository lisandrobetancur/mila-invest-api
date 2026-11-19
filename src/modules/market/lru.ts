/** Caché LRU en proceso: un `Map` con tope (§8.5). El resultado nunca depende de ella. */
export class LruCache<K, V> {
  private readonly entries = new Map<K, V>();

  public constructor(private readonly capacity: number) {
    if (capacity < 1) throw new RangeError('La capacidad de la caché debe ser al menos 1');
  }

  public get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    // Reinsertar mueve la clave al final: el `Map` conserva el orden de inserción.
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  public set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done !== true) this.entries.delete(oldest.value);
    }
  }

  public clear(): void {
    this.entries.clear();
  }

  public get size(): number {
    return this.entries.size;
  }
}
