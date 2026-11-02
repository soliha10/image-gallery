import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { env } from '../env'

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>
  removePrefix(prefix: string): Promise<void>
}

export const localMediaRoot = resolve(env.STORAGE_DIR)

const local: Storage = {
  async put(key, body) {
    const path = join(localMediaRoot, key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, body)
  },
  async removePrefix(prefix) {
    await rm(join(localMediaRoot, prefix), { recursive: true, force: true })
  },
}

function s3(bucket: string): Storage {
  const client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID ?? '', secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '' },
  })
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      )
    },
    async removePrefix(prefix) {
      const { Contents = [] } = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }))
      if (Contents.length === 0) return
      await client.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: Contents.map(({ Key }) => ({ Key })) } }),
      )
    },
  }
}

export const usesLocalStorage = !env.S3_BUCKET
export const storage = env.S3_BUCKET ? s3(env.S3_BUCKET) : local
