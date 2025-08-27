.RECIPEPREFIX := >
CXX := g++
CXXFLAGS := -std=c++17 -Wall -Wextra -O2 $(shell pkg-config --cflags openssl)
LDFLAGS := $(shell pkg-config --libs openssl)
BIN_DIR := bin

all: $(BIN_DIR)/encode $(BIN_DIR)/decode

$(BIN_DIR):
> mkdir -p $(BIN_DIR)

$(BIN_DIR)/encode: core/encode.cpp | $(BIN_DIR)
> $(CXX) $(CXXFLAGS) $< -o $@ $(LDFLAGS)

$(BIN_DIR)/decode: core/decode.cpp | $(BIN_DIR)
> $(CXX) $(CXXFLAGS) $< -o $@ $(LDFLAGS)

clean:
> rm -f $(BIN_DIR)/encode $(BIN_DIR)/decode

.PHONY: all clean
