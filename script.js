const questions = [
  {
    id: 1,
    name: 'Sagrada Família',
    lat: 41.4036,
    lon: 2.1744,
    correct: false
  },
  {
    id: 2,
    name: 'Park Güell',
    lat: 41.4145,
    lon: 2.1527,
    correct: false
  }
];

const threshold = 100; // meters

function dmsToDecimal(dms, ref) {
  const [degrees, minutes, seconds] = dms;
  let dec = degrees + minutes / 60 + seconds / 3600;
  if (ref === 'S' || ref === 'W') dec = -dec;
  return dec;
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function handleFile(question, input, resultSpan) {
  const file = input.files[0];
  if (!file) return;

  EXIF.getData(file, function () {
    const lat = EXIF.getTag(this, 'GPSLatitude');
    const latRef = EXIF.getTag(this, 'GPSLatitudeRef');
    const lon = EXIF.getTag(this, 'GPSLongitude');
    const lonRef = EXIF.getTag(this, 'GPSLongitudeRef');
    if (lat && lon) {
      const photoLat = dmsToDecimal(lat, latRef);
      const photoLon = dmsToDecimal(lon, lonRef);
      const dist = getDistanceMeters(photoLat, photoLon, question.lat, question.lon);
      if (dist <= threshold) {
        question.correct = true;
        resultSpan.textContent = `Correct! (${dist.toFixed(1)} m)`;
      } else {
        resultSpan.textContent = `Not quite (${dist.toFixed(1)} m away)`;
      }
    } else {
      resultSpan.textContent = 'No GPS data found';
    }
    updateScore();
  });
}

function updateScore() {
  const score = questions.filter(q => q.correct).length;
  document.getElementById('score').textContent = `Score: ${score}/${questions.length}`;
}

function init() {
  const container = document.getElementById('questions');
  questions.forEach(q => {
    const div = document.createElement('div');
    div.className = 'question';
    div.innerHTML = `<p>${q.name}</p><input type="file" accept="image/*" /> <span class="result"></span>`;
    const input = div.querySelector('input');
    const result = div.querySelector('.result');
    input.addEventListener('change', () => handleFile(q, input, result));
    container.appendChild(div);
  });
  updateScore();
}

document.addEventListener('DOMContentLoaded', init);
