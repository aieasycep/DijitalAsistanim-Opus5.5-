export function save(setSuccess: (v: boolean) => void): void {
  setTimeout(() => setSuccess(true), 800);
}
