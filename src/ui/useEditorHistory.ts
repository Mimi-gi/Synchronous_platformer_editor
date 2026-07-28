import { useCallback, useRef, useState } from "react";
import type { EditorProject } from "../editor/types";
import type { Operation, Origin } from "../editor/operations";
import { applyOperation, LOCAL_ORIGIN } from "../editor/operations";

const MAX_HISTORY = 100;

/** A committed unit of undo: the forward operations plus their inverses. */
type Transaction = {
  ops: Operation[];
  /** Inverses ordered so applying them in sequence undoes `ops`. */
  inverse: Operation[];
  origin: Origin;
};

function cap(stack: Transaction[]): Transaction[] {
  return stack.length > MAX_HISTORY ? stack.slice(stack.length - MAX_HISTORY) : stack;
}

export type EditorHistory = {
  project: EditorProject;
  /** Reads the latest project synchronously (safe inside event handlers). */
  getSnapshot: () => EditorProject;
  /** Applies an operation and records a single-operation undo entry. */
  dispatch: (op: Operation, origin?: Origin) => void;
  /** Applies several operations as one undo entry. */
  transact: (ops: Operation[], origin?: Origin) => void;
  /** Opens a transaction so following `mutate` calls collapse into one entry. */
  begin: (origin?: Origin) => void;
  /** Applies an operation; buffered when a transaction is open. */
  mutate: (op: Operation) => void;
  /** Closes the open transaction, pushing it onto the undo stack if non-empty. */
  commit: () => void;
  undo: (origin?: Origin) => void;
  redo: (origin?: Origin) => void;
  canUndo: boolean;
  canRedo: boolean;
};

/**
 * Operation-based editor state with origin-tagged undo/redo. `undo(origin)`
 * rewinds the most recent transaction authored by that origin, which is the
 * building block for per-user undo once collaboration lands. With a single
 * local origin this behaves like ordinary linear undo/redo.
 */
export function useEditorHistory(initial: () => EditorProject): EditorHistory {
  const [project, setProject] = useState<EditorProject>(initial);
  const [past, setPast] = useState<Transaction[]>([]);
  const [future, setFuture] = useState<Transaction[]>([]);

  // Always holds the latest project so gestures spanning several renders and
  // event handlers read a fresh value.
  const projectRef = useRef(project);
  projectRef.current = project;

  // Currently open transaction, if any.
  const txRef = useRef<{ ops: Operation[]; inverse: Operation[]; origin: Origin } | null>(null);

  const getSnapshot = useCallback(() => projectRef.current, []);

  const pushTransaction = useCallback((tx: Transaction) => {
    setPast((stack) => cap([...stack, tx]));
    setFuture([]);
  }, []);

  const mutate = useCallback(
    (op: Operation) => {
      const result = applyOperation(projectRef.current, op);
      if (result.project === projectRef.current) return; // no-op

      projectRef.current = result.project;
      setProject(result.project);

      if (txRef.current) {
        txRef.current.ops.push(op);
        txRef.current.inverse.unshift(result.inverse);
      } else {
        pushTransaction({ ops: [op], inverse: [result.inverse], origin: LOCAL_ORIGIN });
      }
    },
    [pushTransaction],
  );

  const dispatch = useCallback(
    (op: Operation, origin: Origin = LOCAL_ORIGIN) => {
      const result = applyOperation(projectRef.current, op);
      if (result.project === projectRef.current) return;

      projectRef.current = result.project;
      setProject(result.project);
      pushTransaction({ ops: [op], inverse: [result.inverse], origin });
    },
    [pushTransaction],
  );

  const begin = useCallback((origin: Origin = LOCAL_ORIGIN) => {
    if (txRef.current) return; // keep the outermost transaction
    txRef.current = { ops: [], inverse: [], origin };
  }, []);

  const transact = useCallback(
    (ops: Operation[], origin: Origin = LOCAL_ORIGIN) => {
      const outer = txRef.current;
      if (!outer) txRef.current = { ops: [], inverse: [], origin };
      for (const op of ops) {
        const result = applyOperation(projectRef.current, op);
        if (result.project === projectRef.current) continue;
        projectRef.current = result.project;
        setProject(result.project);
        txRef.current!.ops.push(op);
        txRef.current!.inverse.unshift(result.inverse);
      }
      if (!outer) {
        const tx = txRef.current;
        txRef.current = null;
        if (tx && tx.ops.length > 0) pushTransaction(tx);
      }
    },
    [pushTransaction],
  );

  const commit = useCallback(() => {
    const tx = txRef.current;
    txRef.current = null;
    if (tx && tx.ops.length > 0) {
      pushTransaction(tx);
    }
  }, [pushTransaction]);

  const undo = useCallback((origin: Origin = LOCAL_ORIGIN) => {
    setPast((stack) => {
      let index = -1;
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].origin === origin) {
          index = i;
          break;
        }
      }
      if (index < 0) return stack;

      const tx = stack[index];
      let next = projectRef.current;
      for (const op of tx.inverse) {
        next = applyOperation(next, op).project;
      }
      projectRef.current = next;
      setProject(next);
      setFuture((forward) => [tx, ...forward]);
      return [...stack.slice(0, index), ...stack.slice(index + 1)];
    });
  }, []);

  const redo = useCallback((origin: Origin = LOCAL_ORIGIN) => {
    setFuture((stack) => {
      const index = stack.findIndex((tx) => tx.origin === origin);
      if (index < 0) return stack;

      const tx = stack[index];
      let next = projectRef.current;
      for (const op of tx.ops) {
        next = applyOperation(next, op).project;
      }
      projectRef.current = next;
      setProject(next);
      setPast((backward) => cap([...backward, tx]));
      return [...stack.slice(0, index), ...stack.slice(index + 1)];
    });
  }, []);

  return {
    project,
    getSnapshot,
    dispatch,
    transact,
    begin,
    mutate,
    commit,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
