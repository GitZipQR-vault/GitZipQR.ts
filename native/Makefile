.RECIPEPREFIX := >
CXX=g++
CXXFLAGS=-O2 -fPIC -std=c++17
LDFLAGS=-lcrypto
TARGET=libgitzipqr_crypto.so

all: $(TARGET)

$(TARGET): crypto_bridge.o
>$(CXX) -shared -o $@ $^ $(LDFLAGS)

crypto_bridge.o: crypto_bridge.cpp
>$(CXX) $(CXXFLAGS) -c crypto_bridge.cpp -o $@

clean:
>rm -f *.o $(TARGET)

.PHONY: all clean
