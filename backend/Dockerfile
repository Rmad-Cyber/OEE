# Gunakan base image Node.js versi 18
FROM node:18-slim

# Set direktori kerja di dalam container
WORKDIR /usr/src/app

# Salin file package.json (dan package-lock.json jika ada)
COPY package*.json ./

# Instal dependensi
RUN npm install

# Salin sisa kode aplikasi
COPY . .

# Ekspos port yang digunakan aplikasi
EXPOSE 8080

# Perintah untuk menjalankan aplikasi
CMD [ "node", "server.js" ]