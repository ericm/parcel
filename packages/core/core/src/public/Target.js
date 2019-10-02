// @flow
import type {
  FilePath,
  Target as ITarget,
  TargetSourceMapOptions,
  Environment as IEnvironment
} from '@parcel/types';
import type {Target as TargetValue} from '../types';
import Environment from './Environment';
import nullthrows from 'nullthrows';

const _targetToInternalTarget: WeakMap<ITarget, TargetValue> = new WeakMap();
export function targetToInternalTarget(target: ITarget): TargetValue {
  return nullthrows(_targetToInternalTarget.get(target));
}

export default class Target implements ITarget {
  #target; // TargetValue

  constructor(target: TargetValue) {
    this.#target = target;
    _targetToInternalTarget.set(this, target);
  }

  get distEntry(): ?FilePath {
    return this.#target.distEntry;
  }

  get distDir(): FilePath {
    return this.#target.distDir;
  }

  get env(): IEnvironment {
    return new Environment(this.#target.env);
  }

  get sourceMap(): ?TargetSourceMapOptions {
    return this.#target.sourceMap;
  }

  get name(): string {
    return this.#target.name;
  }

  get publicUrl(): ?string {
    return this.#target.publicUrl;
  }

  get pipeline(): ?string {
    return this.#target.pipeline;
  }
}
