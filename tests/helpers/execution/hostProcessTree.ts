import { execFileSync } from 'node:child_process';

export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly state: string;
  readonly command: string;
}

/**
 * The host's own view of what is running, read rather than remembered.
 *
 * Live cancel rows exist to answer one question no fake can: after a cancel or
 * an unload, is the provider's process tree *actually* gone. Asking the runner
 * that was supposed to have killed it only proves the runner agrees with
 * itself, so these read `ps` instead.
 *
 * POSIX only. Windows owns a tree through a job object rather than a process
 * group, and `ps` is not how that is read.
 */
export function processTable(): ProcessRow[] {
  const output = execFileSync('ps', ['-eo', 'pid=,ppid=,state=,args='], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const rows: ProcessRow[] = [];
  for (const line of output.split('\n')) {
    const parsed = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (parsed) {
      rows.push({
        pid: Number(parsed[1]),
        ppid: Number(parsed[2]),
        state: parsed[3],
        command: parsed[4],
      });
    }
  }
  return rows;
}

/** The process and everything below it that the table still shows. */
export function processTree(rows: readonly ProcessRow[], pid: number): ProcessRow[] {
  const byParent = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    const siblings = byParent.get(row.ppid);
    if (siblings) {
      siblings.push(row);
    } else {
      byParent.set(row.ppid, [row]);
    }
  }
  const self = rows.find(row => row.pid === pid);
  const found: ProcessRow[] = self ? [self] : [];
  const seen = new Set<number>([pid]);
  const queue: number[] = [pid];
  while (queue.length > 0) {
    for (const child of byParent.get(queue.shift() as number) ?? []) {
      if (seen.has(child.pid)) {
        continue;
      }
      seen.add(child.pid);
      found.push(child);
      queue.push(child.pid);
    }
  }
  return found;
}

/** Everything this process is responsible for whose command matches. */
export function ownedProcesses(matches: (command: string) => boolean): ProcessRow[] {
  return processTree(processTable(), process.pid).filter(row => matches(row.command));
}

/**
 * Alive as the OS means it.
 *
 * `kill(pid, 0)` calls a zombie alive, and a terminated child is a zombie until
 * its parent reaps it — which would fail an assertion about a process that is,
 * in every sense these rows care about, gone.
 */
export function isAlive(pid: number): boolean {
  const row = processTable().find(entry => entry.pid === pid);
  return row !== undefined && !row.state.startsWith('Z');
}
