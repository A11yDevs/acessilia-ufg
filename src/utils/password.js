import argon2 from 'argon2';

export async function hashPassword(plainTextPassword) {
  return await argon2.hash(plainTextPassword, {
    type: argon2.argon2id,
    memoryCost: 2 ** 16, // 64 MB
    timeCost: 3,         // 3 iteracoes
    parallelism: 1
  });
}

export async function verifyPassword(hash, plainTextPassword) {
  try {
    return await argon2.verify(hash, plainTextPassword);
  } catch (err) {
    return false;
  }
}
