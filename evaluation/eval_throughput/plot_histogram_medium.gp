#!/usr/bin/gnuplot

# output: PDF
pdf_size = 3.0; pdf_ratio = 1.6;
set terminal pdfcairo enhanced color lw 1 solid size pdf_size*pdf_ratio,pdf_size font "Helvetica,11"
ext = ".pdf"

# output: SVG
# set terminal svg enhanced size 800,500 dynamic background rgb "white" font ",15"
# ext = ".svg"

# output: PNG
# set terminal pngcairo size 800, 500
# ext = ".png"


# set plot style to histogram bars
set datafile separator ","
set style data histograms
set style histogram cluster gap 1
set style fill solid 0.8 border -1
set boxwidth 0.8

# generic plot options
set grid y
set key nobox top left
# set key at screen 0.11,0.86
set key at screen 0.38,0.86

# axes and labels
set xlabel ""
set xtics out scale 0 rotate by 90 right
set ylabel "Requests per second"
set yrange [0:]

# use second y axis for response times
set y2tics
set y2label "Average Response Time (ms)"
set y2range [0:]

set style fill transparent solid 0.95
set bmargin 6
set xlabel " " offset 0, -0.9

# file usually contains four lines for w(8), s(8), w(10), s(10)
# cols: 1: scen, 2: name, 3: #req, 4: req/s, 5: #fail, 6: fail/s, 7: min, 8: avg, 9: median, 10: max, 11: 99%

# ---> lots-of-tiny series with different amount of servers
# there's three regions in the file, each 16 rows long
FILE = "results/histogram_medium-regions.csv"
set output "plots/histogram_medium-regions_tsp-10".ext;
set title "tsp-10, 64 users"
set yrange [0:250]
set y2range [0:1500]
set ytics 0, 25
set y2tics 0, 150
eWasi = 3; eServ = 4;
# plot \
#   newhistogram "nbg1-fsn1-fsn1", \
#   FILE every 4::eWasi::16  using 4:xtic(2)   title "Wasimoff"               lc 4      , \
#   FILE every 4::eServ::16  using 4           title "Serverledge"            lc 6      , \
#   newhistogram "hil-fsn1-fsn1", \
#   FILE every 4::eWasi+16::32  using 4:xtic(2)   title "Wasimoff"               lc 5      , \
#   FILE every 4::eServ+16::32  using 4           title "Serverledge"            lc 7      , \
#   newhistogram "nbg1-fsn1-hil", \
#   FILE every 4:32:eWasi+32::48  using 4:xtic(2)   title "Wasimoff"               lc 8      , \
#   FILE every 4:32:eServ+32::48  using 4           title "Serverledge"            lc 9      

plot \
  newhistogram "nbg1-fsn1-fsn1", \
  FILE every 4::eWasi::16  using 8 axes x1y2 title "" with lines smooth mcs lc 4 lw 3 , \
  FILE every 4::eServ::16  using 8 axes x1y2 title "" with lines smooth mcs lc 6 lw 3 , \
  FILE every 4::eWasi::16  using 4:xtic(2)   title "Wasimoff"               lc 4      , \
  FILE every 4::eServ::16  using 4           title "Serverledge"            lc 6      , \
  newhistogram "hil-fsn1-fsn1", \
  FILE every 4::eWasi+16::32  using ($0+5):8 axes x1y2 title "" with lines smooth mcs lc 4 lw 3 , \
  FILE every 4::eServ+16::32  using ($0+5):8 axes x1y2 title "" with lines smooth mcs lc 6 lw 3 , \
  FILE every 4::eWasi+16::32  using 4:xtic(2)          title ""                       lc 4      , \
  FILE every 4::eServ+16::32  using 4                  title ""                       lc 6      , \
  newhistogram "nbg1-fsn1-hil", \
  FILE every 4::eWasi+32::48  using ($0+10):8 axes x1y2 title "" with lines smooth mcs lc 4 lw 3 , \
  FILE every 4::eServ+32::48  using ($0+10):8 axes x1y2 title "" with lines smooth mcs lc 6 lw 3 , \
  FILE every 4::eWasi+32::48  using 4:xtic(2)           title ""                       lc 4      , \
  FILE every 4::eServ+32::48  using 4                   title ""                       lc 6      

# ---> replot for tsp-8
set output "plots/histogram_medium-regions_tsp-8".ext;
set title "tsp-8, 64 users"
set yrange [0:2100]
set y2range [0:840]
set ytics 0, 250
set y2tics 0, 100
eWasi = 1; eServ = 2;
replot