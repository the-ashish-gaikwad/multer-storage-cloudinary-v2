'use strict';

const { CloudinaryStorage } = require('./index');
const { Readable, PassThrough } = require('stream');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a mock Cloudinary instance that simulates upload_stream behaviour.
 *
 * @param {object} [opts]
 * @param {Error}  [opts.uploadError]  – If set, the stream will error.
 * @param {object} [opts.uploadResult] – Overrides the default result.
 */
function mockCloudinary({ uploadError, uploadResult } = {}) {
  const defaultResult = {
    public_id: 'test/sample',
    secure_url: 'https://res.cloudinary.com/demo/image/upload/test/sample.jpg',
    url: 'http://res.cloudinary.com/demo/image/upload/test/sample.jpg',
    resource_type: 'image',
    format: 'jpg',
    width: 800,
    height: 600,
    bytes: 12345,
    etag: 'abc123',
    created_at: '2024-01-01T00:00:00Z',
    folder: 'test',
  };

  const result = uploadResult || defaultResult;

  const uploader = {
    upload_stream: jest.fn((options, callback) => {
      const writable = new PassThrough();

      // Simulate async Cloudinary processing
      writable.on('finish', () => {
        setImmediate(() => {
          if (uploadError) {
            callback(uploadError, null);
          } else {
            callback(null, result);
          }
        });
      });

      return writable;
    }),

    destroy: jest.fn(() => Promise.resolve({ result: 'ok' })),
  };

  return { uploader };
}

/**
 * Create a fake multer file with a readable stream.
 */
function mockFile(content = 'fake file content') {
  const stream = Readable.from([Buffer.from(content)]);
  return {
    fieldname: 'file',
    originalname: 'test.jpg',
    encoding: '7bit',
    mimetype: 'image/jpeg',
    stream,
  };
}

/** Mock Express request */
const mockReq = { user: { id: 'user123' } };

// ─── Constructor ──────────────────────────────────────────────────────────────

describe('CloudinaryStorage – constructor', () => {
  test('throws when cloudinary option is missing', () => {
    expect(() => new CloudinaryStorage({})).toThrow(
      /cloudinary.*option is required/i
    );
  });

  test('throws when cloudinary instance has no upload_stream', () => {
    expect(
      () => new CloudinaryStorage({ cloudinary: { uploader: {} } })
    ).toThrow(/upload_stream/i);
  });

  test('accepts a valid cloudinary v2 instance', () => {
    const cloudinary = mockCloudinary();
    expect(() => new CloudinaryStorage({ cloudinary })).not.toThrow();
  });

  test('auto-unwraps cloudinary v1 root object (has .v2 sub-key)', () => {
    const v2 = mockCloudinary();
    const cloudinaryV1Root = { v2 };

    // Should not throw – it will warn to console but still work
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => new CloudinaryStorage({ cloudinary: cloudinaryV1Root })).not.toThrow();
    consoleSpy.mockRestore();
  });
});

// ─── _handleFile ─────────────────────────────────────────────────────────────

describe('CloudinaryStorage – _handleFile', () => {
  test('uploads a file and returns correct fields', (done) => {
    const cloudinary = mockCloudinary();
    const storage = new CloudinaryStorage({
      cloudinary,
      params: { folder: 'uploads' },
    });

    const file = mockFile();

    storage._handleFile(mockReq, file, (err, info) => {
      expect(err).toBeNull();
      expect(info.public_id).toBe('test/sample');
      expect(info.secure_url).toMatch(/^https:\/\//);
      expect(info.path).toBe(info.secure_url);
      expect(info.filename).toBe(info.public_id);
      expect(info.bytes).toBe(12345);
      expect(info.cloudinary).toBeDefined();
      done();
    });
  });

  test('passes static params to upload_stream', (done) => {
    const cloudinary = mockCloudinary();
    const storage = new CloudinaryStorage({
      cloudinary,
      params: {
        folder: 'my-folder',
        format: 'webp',
        resource_type: 'image',
      },
    });

    storage._handleFile(mockReq, mockFile(), (err) => {
      expect(err).toBeNull();
      const callArgs = cloudinary.uploader.upload_stream.mock.calls[0][0];
      expect(callArgs.folder).toBe('my-folder');
      expect(callArgs.format).toBe('webp');
      expect(callArgs.resource_type).toBe('image');
      done();
    });
  });

  test('resolves per-key functional params', (done) => {
    const cloudinary = mockCloudinary();
    const storage = new CloudinaryStorage({
      cloudinary,
      params: {
        folder: (req, file) => `users/${req.user.id}`,
        public_id: (req, file) => `img-${file.originalname}`,
        format: async () => 'png',
      },
    });

    storage._handleFile(mockReq, mockFile(), (err) => {
      expect(err).toBeNull();
      const callArgs = cloudinary.uploader.upload_stream.mock.calls[0][0];
      expect(callArgs.folder).toBe('users/user123');
      expect(callArgs.public_id).toBe('img-test.jpg');
      expect(callArgs.format).toBe('png');
      done();
    });
  });

  test('resolves params from a single async function', (done) => {
    const cloudinary = mockCloudinary();
    const storage = new CloudinaryStorage({
      cloudinary,
      params: async (req, file) => ({
        folder: `dynamic/${req.user.id}`,
        format: 'gif',
      }),
    });

    storage._handleFile(mockReq, mockFile(), (err) => {
      expect(err).toBeNull();
      const callArgs = cloudinary.uploader.upload_stream.mock.calls[0][0];
      expect(callArgs.folder).toBe('dynamic/user123');
      expect(callArgs.format).toBe('gif');
      done();
    });
  });

  test('defaults resource_type to "auto" when not specified', (done) => {
    const cloudinary = mockCloudinary();
    const storage = new CloudinaryStorage({ cloudinary, params: {} });

    storage._handleFile(mockReq, mockFile(), (err) => {
      expect(err).toBeNull();
      const callArgs = cloudinary.uploader.upload_stream.mock.calls[0][0];
      expect(callArgs.resource_type).toBe('auto');
      done();
    });
  });

  test('does NOT override an explicitly set resource_type', (done) => {
    const cloudinary = mockCloudinary();
    const storage = new CloudinaryStorage({
      cloudinary,
      params: { resource_type: 'video' },
    });

    storage._handleFile(mockReq, mockFile(), (err) => {
      expect(err).toBeNull();
      const callArgs = cloudinary.uploader.upload_stream.mock.calls[0][0];
      expect(callArgs.resource_type).toBe('video');
      done();
    });
  });

  test('calls cb with error when upload fails', (done) => {
    const uploadError = new Error('Cloudinary upload failed');
    const cloudinary = mockCloudinary({ uploadError });
    const storage = new CloudinaryStorage({ cloudinary });

    storage._handleFile(mockReq, mockFile(), (err) => {
      expect(err).toBe(uploadError);
      done();
    });
  });

  test('calls cb with error when param resolution throws', (done) => {
    const cloudinary = mockCloudinary();
    const storage = new CloudinaryStorage({
      cloudinary,
      params: async () => {
        throw new Error('param error');
      },
    });

    storage._handleFile(mockReq, mockFile(), (err) => {
      expect(err.message).toBe('param error');
      done();
    });
  });
});

// ─── _removeFile ─────────────────────────────────────────────────────────────

describe('CloudinaryStorage – _removeFile', () => {
  test('calls destroy with the correct public_id', (done) => {
    const cloudinary = mockCloudinary();
    const storage = new CloudinaryStorage({ cloudinary });

    const file = { public_id: 'test/sample', resource_type: 'image' };

    storage._removeFile(mockReq, file, (err) => {
      expect(err).toBeNull();
      expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(
        'test/sample',
        { resource_type: 'image' }
      );
      done();
    });
  });

  test('skips destroy when public_id is missing', (done) => {
    const cloudinary = mockCloudinary();
    const storage = new CloudinaryStorage({ cloudinary });

    storage._removeFile(mockReq, {}, (err) => {
      expect(err).toBeNull();
      expect(cloudinary.uploader.destroy).not.toHaveBeenCalled();
      done();
    });
  });

  test('calls cb with error when destroy fails', (done) => {
    const destroyError = new Error('destroy failed');
    const cloudinary = mockCloudinary();
    cloudinary.uploader.destroy = jest.fn(() => Promise.reject(destroyError));

    const storage = new CloudinaryStorage({ cloudinary });

    storage._removeFile(mockReq, { public_id: 'test/x' }, (err) => {
      expect(err).toBe(destroyError);
      done();
    });
  });
});

// ─── SDK Shape Detection ──────────────────────────────────────────────────────

describe('CloudinaryStorage – SDK shape detection', () => {
  test('works with cloudinary v2 SDK direct import shape', (done) => {
    // Simulates: const cloudinary = require('cloudinary')  [v2 SDK]
    const cloudinaryV2Direct = mockCloudinary();
    const storage = new CloudinaryStorage({ cloudinary: cloudinaryV2Direct });

    storage._handleFile(mockReq, mockFile(), (err, info) => {
      expect(err).toBeNull();
      expect(info.public_id).toBeDefined();
      done();
    });
  });

  test('works when cloudinary v1 root object is passed (auto-unwrap)', (done) => {
    // Simulates: const cloudinary = require('cloudinary')  [v1 SDK, root]
    const v2 = mockCloudinary();
    const cloudinaryV1Root = { v2 };

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = new CloudinaryStorage({ cloudinary: cloudinaryV1Root });
    consoleSpy.mockRestore();

    storage._handleFile(mockReq, mockFile(), (err, info) => {
      expect(err).toBeNull();
      expect(info.public_id).toBeDefined();
      done();
    });
  });
});
