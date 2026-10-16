let axios = require('axios')
let FormData = require('form-data')
let fs = require('fs')
let { fromBuffer } = require('file-type')
let cheerio = require('cheerio')
let fetch = require('node-fetch')



const TelegraPh = async (filePath) => {
    // Cek file
    if (!fs.existsSync(filePath)) {
        throw new Error('File not found');
    }
    
    // Baca file sebagai buffer
    const fileBuffer = fs.readFileSync(filePath);
    
    // Buat form data dengan cara yang benar
    const form = new FormData();
    
    // Append file dengan Blob/Buffer
    // Untuk Node.js, gunakan Buffer dengan options yang benar
    form.append('file', fileBuffer, {
        filename: 'file.jpg',
        contentType: 'image/jpeg'
    });
    
    try {
        // Get headers dari form data
        const headers = {
            ...form.getHeaders(),
            'User-Agent': 'Mozilla/5.0'
        };
        
        // Kirim request
        const response = await axios.post('https://telegra.ph/upload', form, {
            headers: headers,
            timeout: 30000
        });
        
        // Parse response
        const data = response.data;
        
        if (Array.isArray(data) && data[0] && data[0].src) {
            return 'https://telegra.ph' + data[0].src;
        } else {
            throw new Error('Invalid response from Telegraph');
        }
        
    } catch (error) {
        if (error.response) {
            throw new Error(`Telegraph error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        } else {
            throw new Error(`Telegraph: ${error.message}`);
        }
    }
};



async function floNime(filePath) {
    // Validasi input
    if (typeof filePath !== 'string') {
        throw new Error('Input harus berupa path file (string)');
    }
    
    // Cek apakah file ada
    if (!fs.existsSync(filePath)) {
        throw new Error(`File tidak ditemukan: ${filePath}`);
    }
    
    // Cek apakah itu file atau direktori
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
        throw new Error(`Path harus berupa file: ${filePath}`);
    }
    
    // Ambil nama file
    const filename = path.basename(filePath);
    
    // Buat stream file
    const fileStream = fs.createReadStream(filePath);
    
    // Buat FormData
    const form = new FormData();
    
    // Append file ke FormData (mirip seperti CatBox)
    form.append('file', fileStream, {
        filename: filename
        // content-type akan otomatis terdeteksi
    });
    
    // Jika diperlukan parameter tambahan (sesuaikan dengan API uploadyuk)
    // form.append('api_key', 'your_key');
    // form.append('user_id', '123');
    
    try {
        const response = await axios.post('https://uploadyuk.web.id/v1/upload', form, {
            headers: {
                ...form.getHeaders(),
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 30000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });
        
        return response.data;
        
    } catch (error) {
        if (error.response) {
            console.error('Server error:', {
                status: error.response.status,
                data: error.response.data,
                headers: error.response.headers
            });
            throw new Error(`Upload failed: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        } else if (error.request) {
            console.error('No response received:', error.request);
            throw new Error('Tidak ada respons dari server. Periksa koneksi internet Anda.');
        } else {
            console.error('Error:', error.message);
            throw new Error(`Network error: ${error.message}`);
        }
    }
}

// Contoh penggunaan
// floNime('/path/to/image.jpg')
//   .then(result => console.log('Upload berhasil:', result))
//   .catch(error => console.error('Upload gagal:', error.message));



async function CatBox(filePath) {
	try {
		const fileStream = fs.createReadStream(filePath);
		const formData = new FormData()
		formData.append('fileToUpload', fileStream);
		formData.append('reqtype', 'fileupload');
		formData.append('userhash', ''); // Anda dapat memberikan userhash jika diperlukan

		const response = await axios.post('https://catbox.moe/user/api.php', formData, {
			headers: {
				...formData.getHeaders(),
			},
		});

		// Dengan asumsi API mengembalikan URL file sebagai respons
		return response.data;
	} catch (error) {
		console.error("Error at Catbox uploader:", error);
		return "Terjadi kesalahan saat upload ke Catbox.";
	}
}



async function UploadFileUgu (input) {
	return new Promise (async (resolve, reject) => {
			const form = new FormData();
			form.append("files[]", fs.createReadStream(input))
			await axios({
				url: "https://uguu.se/upload.php",
				method: "POST",
				headers: {
					"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36",
					...form.getHeaders()
				},
				data: form
			}).then((data) => {
				resolve(data.data.files[0])
			}).catch((err) => reject(err))
	})
}

function webp2mp4File(path) {
    return new Promise((resolve, reject) => {
        // First, check if the file exists
        if (!fs.existsSync(path)) {
            return reject(new Error(`File not found: ${path}`));
        }

        const form = new FormData();
        form.append('new-image-url', '');
        form.append('new-image', fs.createReadStream(path));

        axios({
            method: 'post',
            url: 'https://s6.ezgif.com/webp-to-mp4',
            data: form,
            headers: {
                'Content-Type': `multipart/form-data; boundary=${form._boundary}`
            }
        }).then(({ data }) => {
            const $ = cheerio.load(data);
            const file = $('input[name="file"]').attr('value');
            
            if (!file) {
                // Check for error messages
                const errorElement = $('.error, .alert, [class*="error"], [class*="alert"]').first();
                const errorMsg = errorElement.length ? errorElement.text().trim() : 'File value not found in response';
                return reject(new Error(`Conversion failed: ${errorMsg}`));
            }

            const bodyFormThen = new FormData();
            bodyFormThen.append('file', file);
            bodyFormThen.append('convert', "Convert WebP to MP4!");

            axios({
                method: 'post',
                url: 'https://ezgif.com/webp-to-mp4/' + file,
                data: bodyFormThen,
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${bodyFormThen._boundary}`
                }
            }).then(({ data }) => {
                const $ = cheerio.load(data);
                
                // Try multiple selectors to find the video source
                let result = $('div#output > p.outfile > video > source').attr('src');
                
                if (!result) {
                    // Alternative selectors
                    result = $('video source').attr('src');
                    result = result || $('a[download]').attr('href');
                    result = result || $('p.outfile a').attr('href');
                }

                if (!result) {
                    // Check if there's an error message
                    const errorMsg = $('.error, .alert, [class*="error"], [class*="alert"]').text().trim();
                    if (errorMsg) {
                        return reject(new Error(`Conversion failed: ${errorMsg}`));
                    }
                    
                    // Debug: log a portion of the HTML to see what's being returned
                    const htmlPreview = data.substring(0, 2000);
                    console.log('HTML preview for debugging:', htmlPreview);
                    
                    return reject(new Error('Could not find converted video URL'));
                }

                // Ensure the URL has the proper protocol
                if (result.startsWith('//')) {
                    result = 'https:' + result;
                } else if (!result.startsWith('http')) {
                    result = 'https://ezgif.com' + (result.startsWith('/') ? result : '/' + result);
                }

                resolve({
                    status: true,
                    message: "Conversion successful",
                    result: result
                });
            }).catch(reject);
        }).catch(reject);
    });
}



async function uptotelegra (Path) {
	return new Promise (async (resolve, reject) => {
		if (!fs.existsSync(Path)) return reject(new Error("File not Found"))
		try {
			const form = new FormData();
			form.append("file", fs.createReadStream(Path))
			const data = await  axios({
				url: "https://telegra.ph/upload",
				method: "POST",
				headers: {
					...form.getHeaders()
				},
				data: form
			})
			return resolve("https://telegra.ph" + data.data[0].src)
		} catch (err) {
			return reject(new Error(String(err)))
		}
	})
}

module.exports = { CatBox, TelegraPh, UploadFileUgu, webp2mp4File, floNime, uptotelegra}
