import { format, formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

export const GOIANIA_TIMEZONE = 'America/Sao_Paulo';

export function toUtcFromGoiania(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;
  return fromZonedTime(date, GOIANIA_TIMEZONE).toISOString();
}

export function fromUtcToGoiania(utcDateString) {
  if (!utcDateString) return null;
  const date = new Date(utcDateString);
  if (isNaN(date.getTime())) return null;
  return toZonedTime(date, GOIANIA_TIMEZONE);
}

export function formatInGoiania(utcDateString, pattern = 'dd/MM/yyyy \'às\' HH:mm') {
  if (!utcDateString) return '';
  const date = new Date(utcDateString);
  if (isNaN(date.getTime())) return '';
  return formatInTimeZone(date, GOIANIA_TIMEZONE, pattern);
}

export function isFutureInGoiania(utcDateString) {
  if (!utcDateString) return false;
  const date = new Date(utcDateString);
  if (isNaN(date.getTime())) return false;
  const nowInGoiania = toZonedTime(new Date(), GOIANIA_TIMEZONE);
  const publishInGoiania = toZonedTime(date, GOIANIA_TIMEZONE);
  return publishInGoiania > nowInGoiania;
}

export function getNowInGoiania() {
  return toZonedTime(new Date(), GOIANIA_TIMEZONE);
}

export function parseGoianiaDateTime(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;
  return fromZonedTime(date, GOIANIA_TIMEZONE);
}

export function toGoianiaISOString(date) {
  if (!date) return null;
  return formatInTimeZone(date, GOIANIA_TIMEZONE, 'yyyy-MM-dd\'T\'HH:mm:ssXXX');
}