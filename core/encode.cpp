#include <openssl/evp.h>
#include <openssl/rand.h>
#include <iostream>
#include <fstream>
#include <vector>
#include <string>

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: encode <input> <output>" << std::endl;
        return 1;
    }
    std::string inPath = argv[1];
    std::string outPath = argv[2];

    std::cout << "Password: ";
    std::string password;
    std::getline(std::cin, password);
    if (password.size() < 8) {
        std::cerr << "Password must be at least 8 characters" << std::endl;
        return 1;
    }

    unsigned char salt[16];
    unsigned char nonce[12];
    if (RAND_bytes(salt, sizeof(salt)) != 1 || RAND_bytes(nonce, sizeof(nonce)) != 1) {
        std::cerr << "Random generation failed" << std::endl;
        return 1;
    }

    const uint64_t N = 1 << 15;
    const uint64_t r = 8;
    const uint64_t p = 1;
    const uint64_t maxmem = 64ULL * 1024 * 1024; // 64MB limit
    unsigned char key[32];
    if (!EVP_PBE_scrypt(password.c_str(), password.size(), salt, sizeof(salt), N, r, p, maxmem, key, sizeof(key))) {
        std::cerr << "scrypt failed" << std::endl;
        return 1;
    }

    std::ifstream fin(inPath, std::ios::binary);
    if (!fin) {
        std::cerr << "Cannot open input file" << std::endl;
        return 1;
    }
    std::vector<unsigned char> plain((std::istreambuf_iterator<char>(fin)), std::istreambuf_iterator<char>());
    fin.close();

    EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
    if (!ctx) {
        std::cerr << "CTX allocation failed" << std::endl;
        return 1;
    }
    if (!EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr)) {
        std::cerr << "EncryptInit failed" << std::endl;
        EVP_CIPHER_CTX_free(ctx);
        return 1;
    }
    if (!EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN, sizeof(nonce), nullptr)) {
        std::cerr << "IV length set failed" << std::endl;
        EVP_CIPHER_CTX_free(ctx);
        return 1;
    }
    if (!EVP_EncryptInit_ex(ctx, nullptr, nullptr, key, nonce)) {
        std::cerr << "EncryptInit key failed" << std::endl;
        EVP_CIPHER_CTX_free(ctx);
        return 1;
    }

    std::vector<unsigned char> cipher(plain.size());
    int len = 0;
    int outlen = 0;
    if (!EVP_EncryptUpdate(ctx, cipher.data(), &len, plain.data(), plain.size())) {
        std::cerr << "EncryptUpdate failed" << std::endl;
        EVP_CIPHER_CTX_free(ctx);
        return 1;
    }
    outlen = len;
    if (!EVP_EncryptFinal_ex(ctx, cipher.data() + outlen, &len)) {
        std::cerr << "EncryptFinal failed" << std::endl;
        EVP_CIPHER_CTX_free(ctx);
        return 1;
    }
    outlen += len;
    cipher.resize(outlen);

    unsigned char tag[16];
    if (!EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_GET_TAG, sizeof(tag), tag)) {
        std::cerr << "Get tag failed" << std::endl;
        EVP_CIPHER_CTX_free(ctx);
        return 1;
    }
    EVP_CIPHER_CTX_free(ctx);

    std::ofstream fout(outPath, std::ios::binary);
    if (!fout) {
        std::cerr << "Cannot open output file" << std::endl;
        return 1;
    }
    fout.write(reinterpret_cast<char*>(salt), sizeof(salt));
    fout.write(reinterpret_cast<char*>(nonce), sizeof(nonce));
    fout.write(reinterpret_cast<char*>(cipher.data()), cipher.size());
    fout.write(reinterpret_cast<char*>(tag), sizeof(tag));
    fout.close();

    std::cout << "Encrypted to " << outPath << std::endl;
    return 0;
}

