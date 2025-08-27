#include <openssl/evp.h>
#include <iostream>
#include <fstream>
#include <vector>
#include <string>

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: decode <input> <output>" << std::endl;
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

    std::ifstream fin(inPath, std::ios::binary);
    if (!fin) {
        std::cerr << "Cannot open input file" << std::endl;
        return 1;
    }
    std::vector<unsigned char> file((std::istreambuf_iterator<char>(fin)), std::istreambuf_iterator<char>());
    fin.close();
    if (file.size() < 44) { // salt+nonce+tag minimal
        std::cerr << "Input too small" << std::endl;
        return 1;
    }

    unsigned char* salt = file.data();
    unsigned char* nonce = file.data() + 16;
    unsigned char* tag = file.data() + file.size() - 16;
    unsigned char* cipher = file.data() + 28;
    size_t cipherLen = file.size() - 44; // total minus salt/nonce/tag

    const uint64_t N = 1 << 15;
    const uint64_t r = 8;
    const uint64_t p = 1;
    const uint64_t maxmem = 64ULL * 1024 * 1024;
    unsigned char key[32];
    if (!EVP_PBE_scrypt(password.c_str(), password.size(), salt, 16, N, r, p, maxmem, key, sizeof(key))) {
        std::cerr << "scrypt failed" << std::endl;
        return 1;
    }

    EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
    if (!ctx) {
        std::cerr << "CTX allocation failed" << std::endl;
        return 1;
    }
    if (!EVP_DecryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr)) {
        std::cerr << "DecryptInit failed" << std::endl;
        EVP_CIPHER_CTX_free(ctx);
        return 1;
    }
    if (!EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN, 12, nullptr)) {
        std::cerr << "IV length set failed" << std::endl;
        EVP_CIPHER_CTX_free(ctx);
        return 1;
    }
    if (!EVP_DecryptInit_ex(ctx, nullptr, nullptr, key, nonce)) {
        std::cerr << "DecryptInit key failed" << std::endl;
        EVP_CIPHER_CTX_free(ctx);
        return 1;
    }

    std::vector<unsigned char> plain(cipherLen);
    int len = 0;
    int outlen = 0;
    if (!EVP_DecryptUpdate(ctx, plain.data(), &len, cipher, cipherLen)) {
        std::cerr << "DecryptUpdate failed" << std::endl;
        EVP_CIPHER_CTX_free(ctx);
        return 1;
    }
    outlen = len;
    if (!EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_TAG, 16, tag)) {
        std::cerr << "Set tag failed" << std::endl;
        EVP_CIPHER_CTX_free(ctx);
        return 1;
    }
    if (!EVP_DecryptFinal_ex(ctx, plain.data() + outlen, &len)) {
        std::cerr << "Decryption failed" << std::endl;
        EVP_CIPHER_CTX_free(ctx);
        return 1;
    }
    outlen += len;
    plain.resize(outlen);
    EVP_CIPHER_CTX_free(ctx);

    std::ofstream fout(outPath, std::ios::binary);
    if (!fout) {
        std::cerr << "Cannot open output file" << std::endl;
        return 1;
    }
    fout.write(reinterpret_cast<char*>(plain.data()), plain.size());
    fout.close();

    std::cout << "Decrypted to " << outPath << std::endl;
    return 0;
}

