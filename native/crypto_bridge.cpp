#include <openssl/evp.h>
#include <cstring>
#include <cstdint>
#include <fstream>
#include <vector>

static int hex_to_bytes(const char* hex, unsigned char* out, size_t out_len){
  size_t len = strlen(hex);
  if(len != out_len*2) return -1;
  for(size_t i=0;i<out_len;i++){
    unsigned int byte;
    if(sscanf(hex + 2*i, "%2x", &byte) != 1) return -1;
    out[i] = static_cast<unsigned char>(byte);
  }
  return 0;
}

extern "C" int aes256gcm_encrypt(const char* input_path, const char* output_path, const char* password,
                                 const char* salt_hex, const char* nonce_hex,
                                 unsigned int N, unsigned int r, unsigned int p){
  unsigned char salt[16];
  unsigned char nonce[12];
  if(hex_to_bytes(salt_hex, salt, sizeof(salt)) != 0) return 1;
  if(hex_to_bytes(nonce_hex, nonce, sizeof(nonce)) != 0) return 1;

  std::ifstream in(input_path, std::ios::binary);
  if(!in) return 2;
  std::vector<unsigned char> plaintext((std::istreambuf_iterator<char>(in)),{});
  in.close();

  unsigned char key[32];
  if(EVP_PBE_scrypt(password, strlen(password), salt, sizeof(salt),
                    (uint64_t)N, (uint64_t)r, (uint64_t)p, 0, key, sizeof(key)) != 1)
    return 3;

  EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
  if(!ctx) return 4;
  std::vector<unsigned char> ciphertext(plaintext.size()+16);
  int len=0, ct_len=0;
  if(EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, NULL, NULL) != 1){ EVP_CIPHER_CTX_free(ctx); return 4; }
  if(EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_AEAD_SET_IVLEN, sizeof(nonce), NULL) != 1){ EVP_CIPHER_CTX_free(ctx); return 4; }
  if(EVP_EncryptInit_ex(ctx, NULL, NULL, key, nonce) != 1){ EVP_CIPHER_CTX_free(ctx); return 4; }
  if(EVP_EncryptUpdate(ctx, ciphertext.data(), &len, plaintext.data(), plaintext.size()) != 1){ EVP_CIPHER_CTX_free(ctx); return 4; }
  ct_len = len;
  if(EVP_EncryptFinal_ex(ctx, ciphertext.data()+len, &len) != 1){ EVP_CIPHER_CTX_free(ctx); return 4; }
  ct_len += len;
  unsigned char tag[16];
  if(EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_AEAD_GET_TAG, 16, tag) != 1){ EVP_CIPHER_CTX_free(ctx); return 4; }
  EVP_CIPHER_CTX_free(ctx);

  std::ofstream out(output_path, std::ios::binary);
  if(!out) return 2;
  out.write(reinterpret_cast<char*>(ciphertext.data()), ct_len);
  out.write(reinterpret_cast<char*>(tag), 16);
  out.close();
  return 0;
}

extern "C" int aes256gcm_decrypt(const char* input_path, const char* output_path, const char* password,
                                 const char* salt_hex, const char* nonce_hex,
                                 unsigned int N, unsigned int r, unsigned int p){
  unsigned char salt[16];
  unsigned char nonce[12];
  if(hex_to_bytes(salt_hex, salt, sizeof(salt)) != 0) return 1;
  if(hex_to_bytes(nonce_hex, nonce, sizeof(nonce)) != 0) return 1;

  std::ifstream in(input_path, std::ios::binary);
  if(!in) return 2;
  std::vector<unsigned char> buffer((std::istreambuf_iterator<char>(in)),{});
  in.close();
  if(buffer.size()<16) return 5;
  size_t tag_pos = buffer.size()-16;
  std::vector<unsigned char> ciphertext(buffer.begin(), buffer.begin()+tag_pos);
  unsigned char tag[16];
  memcpy(tag, buffer.data()+tag_pos, 16);

  unsigned char key[32];
  if(EVP_PBE_scrypt(password, strlen(password), salt, sizeof(salt),
                    (uint64_t)N, (uint64_t)r, (uint64_t)p, 0, key, sizeof(key)) != 1)
    return 3;

  EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
  if(!ctx) return 4;
  std::vector<unsigned char> plaintext(ciphertext.size());
  int len=0, pt_len=0;
  if(EVP_DecryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, NULL, NULL) != 1){ EVP_CIPHER_CTX_free(ctx); return 4; }
  if(EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_AEAD_SET_IVLEN, sizeof(nonce), NULL) != 1){ EVP_CIPHER_CTX_free(ctx); return 4; }
  if(EVP_DecryptInit_ex(ctx, NULL, NULL, key, nonce) != 1){ EVP_CIPHER_CTX_free(ctx); return 4; }
  if(EVP_DecryptUpdate(ctx, plaintext.data(), &len, ciphertext.data(), ciphertext.size()) != 1){ EVP_CIPHER_CTX_free(ctx); return 4; }
  pt_len = len;
  if(EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_AEAD_SET_TAG, 16, tag) != 1){ EVP_CIPHER_CTX_free(ctx); return 4; }
  if(EVP_DecryptFinal_ex(ctx, plaintext.data()+len, &len) != 1){ EVP_CIPHER_CTX_free(ctx); return 6; }
  pt_len += len;
  EVP_CIPHER_CTX_free(ctx);

  std::ofstream out(output_path, std::ios::binary);
  if(!out) return 2;
  out.write(reinterpret_cast<char*>(plaintext.data()), pt_len);
  out.close();
  return 0;
}

