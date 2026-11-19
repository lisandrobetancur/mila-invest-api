import { AppError } from '../../core/errors.js';

export function instrumentNotFound(instrumentId: string): AppError {
  return new AppError('INSTRUMENT_NOT_FOUND', {
    detail: `No existe el instrumento ${instrumentId}`,
  });
}
