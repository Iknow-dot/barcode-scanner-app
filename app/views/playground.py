from cryptography.fernet import Fernet
key = Fernet.generate_key()
print("Fernet Key:", key.decode())